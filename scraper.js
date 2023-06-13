
const oldFetch = window.fetch;

const deferredAuthorizationHeader = deferredPromise();
let authorizationHeader = null;

console.info(`[Reddit Scraper] Injecting custom window.fetch()...`);

/**
 *
 * @param {Parameters<globalThis['fetch']>[0]} input
 * @param {Parameters<globalThis['fetch']>[1]} init
 * @returns {ReturnType<globalThis['fetch']>}
 */
window.fetch = function (input, init) {
    if (!authorizationHeader && init && init.headers) {
        if (Array.isArray(init.headers)) {
            authorizationHeader = init.headers.find(([key]) => key.toLowerCase() === "authorization") || null;
        } else if (init.headers instanceof Headers) {
            authorizationHeader = init.headers.get("Authorization");
        } else {
            const authKey = Object.keys(init.headers).find(([key]) => key.toLowerCase() === "authorization");

            if (authKey) authorizationHeader = init.headers[authKey] || null;
        }

        if (authorizationHeader) {
            deferredAuthorizationHeader.resolve();
        }
    }

    return oldFetch(input, init);
}

window.__supplyToken = function (header) {
    authorizationHeader = `Bearer: ${header.replace(/^Authorization:\s*Bearer:\s*/i, "")}`;
    deferredAuthorizationHeader.resolve();
}

console.info(`[Reddit Scraper] Waiting for an authenticated request by reddit... Try to scroll to the end of a page to trigger a request.\n`
    + `Alternatively, open the Network tab and inspect a "gql.reddit.com" request. Copy the <strong>entire</strong> value of the "Authorization" header `
    + `and call the __supplyToken("myAuthorizationHeader") function, where myAuthorizationHeader is what you just copied.`);
await deferredAuthorizationHeader.promise;
delete window.__supplyToken;

console.warn(`[Reddit Scraper] Got authorization header: ${authorizationHeader}`);


// for (const [id, url] of posts) {
//     try {
//         const postApiUrl = new URL(url);
//         postApiUrl.pathname += ".json"
//         postApiUrl.searchParams.set("limit", "100");
//         postApiUrl.searchParams.set("raw_json", "1");

//         const response = await fetch(postApiUrl, {
//             headers: { 'user-agent': navigator.userAgent }
//         });

//         /** @type {Record<any, any>[]} */
//         let jsonBody = await response.json();

//         if (response.status != 200 || typeof jsonBody.status == 'number') {
//             throw new Error(`Request "${url}" failed. ${JSON.stringify(jsonBody)}`);
//         }

//         let postJsonData = jsonBody.flatMap(x => x.data.children);

//         /** @type {null | { createdAt: number; content: string; author: string; title: string; nsfw: boolean; subreddit: string; snakecase_title: string; id: string; }} */
//         let postInformation = null;
//         /** @type {Node} */
//         let postComments = new Node(null, null);

//         for (const child of postJsonData) {
//             const processResult = processChild(child, postComments);
//             if (!processResult) continue;

//             switch (processResult.type) {
//                 case "post":
//                     postInformation = processResult.data;
//                     break;
//             }
//         }

//         if (!postInformation) {
//             throw new Error(`Request "${url}" has no post object.`);
//         }

//         const title = `[${postInformation.id}] ${postInformation.snakecase_title}`;

//         await fs.mkdir(`./Reddit Takeout/_raw/${postInformation.subreddit}`, { recursive: true });
//         await fs.writeFile(`./Reddit Takeout/_raw/${postInformation.subreddit}/${title}.json`, JSON.stringify(postJsonData, null, 4));

//         await fs.mkdir(`./Reddit Takeout/${postInformation.subreddit}`, { recursive: true });
//         const fileHandle = await fs.open(`./Reddit Takeout/${postInformation.subreddit}/${title}.md`, "w+");

//         await formatMdDocument(fileHandle, postInformation, postComments);
//         await fileHandle.close();

//         console.log(`Downloaded "${url}"`);
//     } catch (err) {
//         console.error(`[${id}] FAILED: ${err}`);

//         await fs.open("./failed.csv", "a")
//             .then(async file => {
//                 await file.appendFile(`${id},${url}\n`);
//                 return file;
//             })
//             .then(file => file.close())
//             .catch(() => null);
//     }
// }

// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
// @@@@@@@@@ UTILITY FUNCTIONS AND CLASSES @@@@@@@@@
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@

class Node {
    /** @type {Map<string, Node>} */
    #children = new Map();

    /** @type {string | null} */
    key = null;
    /** @type {any} */
    value = null;

    /**
     *
     * @param {string | null} id
     * @param {any} value
     */
    constructor(id, value) {
        this.value = value;
        this.key = id;
    }

    /**
     *  @param {Node} child
     *  @returns {Node}
     */
    insert(child) {
        this.#children.set(child.key, child);
        return child;
    }

    /**
     *  @param {string} id
     *  @returns {Node | null}
     */
    find(id) {
        if (this.key === id) return this;

        for (const [, node] of this.#children) {
            const found = node.find(id);
            if (found !== null) return found;
        }

        return null;
    }

    /** @returns {Generator<[number, Node]>} */
    *[Symbol.iterator](__currentDepth = 0) {
        if (this.key !== null)
            yield [__currentDepth++, this];

        for (const child of this.#children.values()) {
            yield* child[Symbol.iterator](__currentDepth);
        }
    }
}

/**
 *
 * @param {number} unixTimestamp
 * @returns {Date}
 */
function fromUnix(unixTimestamp) {
    const d = new Date(0);
    d.setUTCSeconds(Math.round(unixTimestamp));

    return d;
}

/**
 *
 * @param {string} raw
 * @returns {string}
 */
function escapeMarkdown(raw) {
    return raw.replace(/([\\[\]()*_~#|`])/ig, "\\$1")
}

/**
 *
 * @param {any} childData
 * @param {Node} parentNode
 * @returns
 */
function processChild(childData, parentNode) {
    const data = childData.data;

    switch (childData.kind) {
        case "t1": // Comment
            const newParent = parentNode.insert(new Node(data.id, {
                createdAt: data.created_utc,
                content: data.body,
                author: data.author,
            }));

            if (typeof childData.data.replies != "string") {
                childData.data.replies.data.children.forEach(x => {
                    processChild(x, newParent);
                })
            }

            break;
        case "t3": { // Link messages
            let snakeCaseTitle = data.permalink.split('/');

            if (snakeCaseTitle) snakeCaseTitle = snakeCaseTitle[snakeCaseTitle.length - 2];
            else data.title.toLowerCase().replaceAll(' ', '_');

            return {
                type: "post",
                data: {
                    url: `https://reddit.com${data.permalink}`,
                    snakecase_title: snakeCaseTitle,
                    createdAt: data.created_utc,
                    subreddit: data.subreddit,
                    content: data.selftext,
                    nsfw: !!data.over_18,
                    author: data.author,
                    title: data.title,
                    id: data.id,
                }
            }
        }
        case "t2": // Account
        case "t4": // Private messages??
        case "t5": // Subreddit
        case "t6": // Awards
            break;
    }

    return null;
}

/**
 *
 * @param {import("fs/promises").FileHandle} fileHandle
 * @param {{ createdAt: number; content: string; author: string; title: string; nsfw: boolean; subreddit: string; snakecase_title: string; id: string; url: string; }} postInformation
 * @param {Node} postComments
 */
async function formatMdDocument(fileHandle, postInformation, postComments) {
    let results = `# [${escapeMarkdown(postInformation.title)}](${postInformation.url}) ${postInformation.nsfw ? "🔞" : ""}\n###### (*By ${postInformation.author == "[deleted]" ? '[deleted]' : `[u/${postInformation.author}](https://reddit.com/u/${postInformation.author})`
        } at \`${fromUnix(postInformation.createdAt)}\` in [r/${postInformation.subreddit}](https://reddit.com/r/${postInformation.subreddit})*)\n\n`;

    results += `${postInformation.content || (new URL(postInformation.url).host !== "reddit.com" ? `*${postInformation.url}*\n` : "")}\n`

    results += `# Comments\n\n`;

    for (const [depth, node] of postComments) {
        const padding = "> ".repeat(depth);
        const data = node.value;

        results += `${padding}#### *By ${postInformation.author == "[deleted]" ? '[deleted]' : `[u/${postInformation.author}](https://reddit.com/u/${postInformation.author})`} at \`${fromUnix(data.createdAt)}\`*\n`

        for (const line of data.content.split("\n")) {
            results += `${padding}${line}\n`;
        }
    }

    await fileHandle.writeFile(results);
}

/** @returns {{promise: Promise<T>, resolve(): void, reject(): void }} */
function deferredPromise() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    })

    return { promise, resolve, reject };
}
