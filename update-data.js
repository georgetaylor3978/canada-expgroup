/**
 * update-data.js
 * ─────────────────────────────────────────────────────────────
 *  1. Reads MapDeptGroup.xlsx  (your manual department mapping)
 *  2. Fetches ALL records from the Open Canada API
 *  3. Joins them together in memory
 *  4. Writes data.js  (pre-baked, CORS-free, loads via <script>)
 *
 * Usage:  node update-data.js
 * Then:   double-click update.bat to push to GitHub
 * ─────────────────────────────────────────────────────────────
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const https = require('https');

const MAP_FILE = 'MapDeptGroup.xlsx';
const OUTPUT_JS = 'data.js';

// Open Canada API — Public Accounts: Expenditures by Org and SOBJ
const API_URL = 'https://open.canada.ca/data/api/3/action/datastore_search' +
    '?resource_id=27e54a33-3c39-42a9-8d58-46dd37c527e5&limit=32000';

// Sentinel for unmapped organizations
const EMPTY_MAP_LABEL = '<EMPTY FIELD - MAP>';

console.log('\n📊 Canada ExpGroup — Data Builder');
console.log('─'.repeat(45));

// ── Step 1: Load MapDeptGroup.xlsx ────────────────────────────
const mapPath = path.join(__dirname, MAP_FILE);
if (!fs.existsSync(mapPath)) {
    console.error(`\n❌ Error: "${MAP_FILE}" not found in this folder.`);
    process.exit(1);
}

console.log(`📂 Reading: ${MAP_FILE}`);
const wb = XLSX.readFile(mapPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
const headers = raw[0].map(h => String(h || '').trim());
const colOrg = headers.indexOf('org_name');
const colDept = headers.indexOf('Dept');

if (colOrg === -1 || colDept === -1) {
    console.error(`\n❌ Error: Expected columns 'org_name' and 'Dept' in ${MAP_FILE}.`);
    console.error(`   Found: ${headers.join(', ')}`);
    process.exit(1);
}

const mapping = {};
for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const orgName = r[colOrg] ? String(r[colOrg]).trim() : null;
    const dept = r[colDept] ? String(r[colDept]).trim() : null;
    if (orgName && dept) mapping[orgName] = dept;
}

const mappedOrgCount = Object.keys(mapping).length;
const mappedDeptCount = new Set(Object.values(mapping)).size;
console.log(`   ✅ ${mappedOrgCount} orgs → ${mappedDeptCount} dept groups`);

// ── Step 2: Fetch API data ────────────────────────────────────
console.log('\n🌐 Fetching from Open Canada API …');
console.log(`   ${API_URL}`);

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        let body = '';
        https.get(url, { headers: { 'User-Agent': 'CanadaExpGroupDashboard/1.0' } }, res => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

(async () => {
    let apiData;
    try {
        apiData = await httpsGet(API_URL);
    } catch (e) {
        console.error(`\n❌ API fetch failed: ${e.message}`);
        console.error('   Check your internet connection and try again.');
        process.exit(1);
    }

    if (!apiData.success) {
        console.error('\n❌ API returned success=false');
        process.exit(1);
    }

    const records = apiData.result.records;
    console.log(`   ✅ Received ${records.length} records`);

    // ── Step 3: Process & Join ──────────────────────────────
    console.log('\n⚙️  Processing and joining data …');

    const years = [];   // unique year integers
    const parents = [];   // dept groups
    const children = [];   // org_names
    const slicerCats = [];   // sobj_en values
    const data = [];   // compressed rows: [yIdx, pIdx, cIdx, sIdx, amount]
    const unmapped = new Set();

    function getIndex(arr, val) {
        let idx = arr.indexOf(val);
        if (idx === -1) { idx = arr.length; arr.push(val); }
        return idx;
    }

    for (const r of records) {
        // Parse fiscal year: "2021-22" → 2021
        const fyStr = String(r.fy_ef || '').trim();
        const year = parseInt(fyStr.split('-')[0], 10);
        if (isNaN(year)) continue;

        const orgName = String(r.org_name || '').trim();
        const sobject = String(r.sobj_en || '').trim();
        const amount = parseFloat(r.expenditures) || 0;
        if (amount === 0) continue; // skip zero-value rows

        // Join: look up Dept group
        let dept;
        if (mapping[orgName]) {
            dept = mapping[orgName];
        } else {
            dept = EMPTY_MAP_LABEL;
            unmapped.add(orgName);
        }

        const yIdx = getIndex(years, year);
        const pIdx = getIndex(parents, dept);
        const cIdx = getIndex(children, orgName);
        const sIdx = getIndex(slicerCats, sobject);

        data.push([yIdx, pIdx, cIdx, sIdx, amount]);
    }

    // Sort SOBJ categories alphabetically and remap indices
    const slicerOrder = slicerCats
        .map((s, i) => ({ name: s, oldIdx: i }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const slicerRemap = {};
    const sortedSlicers = [];
    slicerOrder.forEach(({ name, oldIdx }, newIdx) => {
        slicerRemap[oldIdx] = newIdx;
        sortedSlicers.push(name);
    });
    for (let j = 0; j < data.length; j++) {
        data[j][3] = slicerRemap[data[j][3]];
    }

    const output = {
        years,
        parents,
        children,
        slicerCats: sortedSlicers,
        data,
        meta: {
            generatedAt: new Date().toISOString(),
            totalRecords: records.length,
            processedRows: data.length,
            unmappedOrgs: Array.from(unmapped).sort()
        }
    };

    // ── Step 4: Write data.js ──────────────────────────────
    const json = JSON.stringify(output);
    const jsOutput = '/* Auto-generated by update-data.js — do not edit manually */\n' +
        'var DASHBOARD_DATA = ' + json + ';\n';
    const outPath = path.join(__dirname, OUTPUT_JS);
    fs.writeFileSync(outPath, jsOutput);

    const sizeMB = (Buffer.byteLength(jsOutput) / 1024 / 1024).toFixed(2);
    const unmappedCount = unmapped.size;

    console.log(`\n✅ Generated: ${OUTPUT_JS}`);
    console.log(`   ${data.length} data points`);
    console.log(`   ${years.length} years  |  ${parents.length} dept groups  |  ${children.length} orgs  |  ${sortedSlicers.length} SOBJ types`);
    console.log(`   File size: ${sizeMB} MB`);

    if (unmappedCount > 0) {
        console.log(`\n⚠️  ${unmappedCount} organizations are NOT in MapDeptGroup.xlsx:`);
        unmapped.forEach(o => console.log(`     - ${o}`));
        console.log(`   → They will appear as "${EMPTY_MAP_LABEL}" in the dashboard.`);
        console.log(`   → Add them to MapDeptGroup.xlsx and re-run this script.`);
    } else {
        console.log(`\n🎉 All organizations are mapped — no missing entries!`);
    }

    console.log('\n🚀 Run "update.bat" to push to GitHub.\n');
})();
