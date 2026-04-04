const http = require('http');

const EMP_UID = "2458CA2B";
const COMP_UID = "D6F87C05";
const NEW_EMP_UID = "TEST_EMP_999";
const NEW_COMP_UID = "TEST_COMP_999";

function makeRequest(path, method, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 3000,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json', ...headers }
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
    console.log("=========================================");
    console.log("   INTELLIGENT INVENTORY HEALTH CHECK   ");
    console.log("=========================================\n");

    try {
        // 1. Test Admin Login
        console.log("[1] Testing Secure Login API...");
        let res = await makeRequest('/api/login', 'POST', { username: "admin", password: "admin" });
        if (res.status === 200) console.log("✅ Admin Login Successful!");
        else throw new Error("Admin Login Failed");

        const authHeaders = { Authorization: `Bearer ${res.body.token}` };

        // 2. Test Management UI (Add/Delete)
        console.log("\n[2] Testing Management APIs (Staff & Inventory)...");
        // Add Temporary Staff
        await makeRequest('/api/employees', 'POST', { uid: NEW_EMP_UID, name: "Test Engineer" }, authHeaders);
        // Add Temporary Component
        await makeRequest('/api/components', 'POST', { uid: NEW_COMP_UID, name: "Test Multimeter" }, authHeaders);

        // Verify they exist
        res = await makeRequest('/api/inventory', 'GET', null, authHeaders);
        const hasComp = res.body.components.some(c => c.uid === NEW_COMP_UID);
        res = await makeRequest('/api/employees', 'GET', null, authHeaders);
        const hasEmp = res.body.employees.some(e => e.uid === NEW_EMP_UID);

        if (hasComp && hasEmp) console.log("✅ Add Component/Staff Successful!");
        else throw new Error("Management API Creation Failed");

        // 3. Test Order-Agnostic Gate Scan (no approval required)
        console.log("\n[3] Testing Order-Agnostic Gate Logic...");
        // Scan (Employee first, then Component)
        res = await makeRequest('/api/transactions/scan', 'POST', { componentUid: NEW_EMP_UID, employeeUid: NEW_COMP_UID });
        if (res.status === 200) console.log("✅ Authorized checkout successful with reversed scan order!");
        else throw new Error("Authorized checkout failed");

        // 4. Cleanup (Delete test entities)
        console.log("\n[4] Cleaning up test data...");
        await makeRequest(`/api/employees/${NEW_EMP_UID}`, 'DELETE', null, authHeaders);
        await makeRequest(`/api/components/${NEW_COMP_UID}`, 'DELETE', null, authHeaders);
        console.log("✅ Cleanup Complete.");

        console.log("\n=========================================");
        console.log("         SYSTEM STATUS: STABLE 🟢       ");
        console.log("=========================================");

    } catch (err) {
        console.error("\n❌ HEALTH CHECK FAILED:");
        if (err.status) console.error(`- Status Code: ${err.status}`);
        if (err.body) console.error(`- Response Body: ${JSON.stringify(err.body)}`);
        console.error(`- Error: ${err.message || err}`);
        process.exit(1);
    }
})();
