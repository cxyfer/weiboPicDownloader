chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FETCH_BLOB_URL') {
        fetchAsBlobUrl(msg.url)
            .then(blobUrl => sendResponse({ ok: true, blobUrl }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true; // Keep channel open
    }

    if (msg.type === 'REVOKE_BLOB_URL') {
        if (msg.url) {
            URL.revokeObjectURL(msg.url);
        }
        // No response needed
    }
});

async function fetchAsBlobUrl(url) {
    const response = await fetch(url, {
        method: 'GET',
        referrerPolicy: 'unsafe-url'
    });
    if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
}
