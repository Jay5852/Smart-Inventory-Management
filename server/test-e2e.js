const http = require('http');

const EMP_UID = "2458CA2B";
const COMP_UID = "D6F87C05";

function makeRequest(path, method, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch (e) { }
                resolve({ status: res.statusCode, body: parsed });
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

(async () => {
    console.log("=== STARTING E2E TEST ===");

    console.log(`\n[1] Employee (${EMP_UID}) requests Component (${COMP_UID})...`);
    let res = await makeRequest('/api/requests', 'POST', { employeeUid: EMP_UID, componentUid: COMP_UID });
    console.log("Status:", res.status, "Response:", res.body);

    console.log("\n[2] Admin gathering pending requests...");
    res = await makeRequest('/api/requests', 'GET');
    const req = res.body.requests.find(r => r.status === 'pending');
    if (!req) { console.log("No pending requests found!"); return; }
    console.log(`Found pending request ID: ${req.id}`);

    console.log(`\n[3] Admin approving request #${req.id}...`);
    res = await makeRequest(`/api/requests/${req.id}/approve`, 'POST');
    console.log("Status:", res.status, "Response:", res.body);

    console.log("\n[4] Gate Scan (Check OUT) - Scan Order: COMPONENT then EMPLOYEE...");
    // Simulate what the ESP32 sends: it doesn't know which is which, it just sends ID1 = COMP_UID, ID2 = EMP_UID
    res = await makeRequest('/api/transactions/scan', 'POST', { componentUid: COMP_UID, employeeUid: EMP_UID });
    console.log("Status:", res.status, "Response:", res.body);

    console.log("\n[5] Gate Scan (Check IN) - Scan Order: EMPLOYEE then COMPONENT...");
    // Simulate reverse scan order: ID1 = EMP_UID, ID2 = COMP_UID
    res = await makeRequest('/api/transactions/scan', 'POST', { componentUid: EMP_UID, employeeUid: COMP_UID });
    console.log("Status:", res.status, "Response:", res.body);

    console.log("\n=== E2E TEST COMPLETE ===");
})();
