"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const providers_1 = require("./providers");
const metadata_1 = require("./metadata");
async function main() {
    const manager = new providers_1.ProviderManager();
    const testId = process.argv[2] || 'tt0137523'; // Fight Club
    const testType = (process.argv[3] || (testId.includes(':') ? 'series' : 'movie'));
    const testProvider = process.argv[4] || 'all';
    console.log(`\n🔍 Testing ProviderManager for ID: ${testId} (Type: ${testType}, Provider: ${testProvider})...`);
    try {
        const target = (0, metadata_1.parseStremioId)(testType, testId);
        const streams = await manager.getStreams(target, 'http://localhost:7000', undefined, testProvider);
        console.log(`\n✅ Success! Total streams received: ${streams.length}\n`);
        // Group streams by provider brand (Movy, Hexa, MovieBox, Rivestream)
        const grouped = {};
        for (const s of streams) {
            const brand = s.name.split(' ')[0];
            grouped[brand] = (grouped[brand] || 0) + 1;
        }
        console.log('📊 Streams summary by provider:');
        for (const [brand, count] of Object.entries(grouped)) {
            console.log(`   - ${brand}: ${count} stream(s)`);
        }
        console.log('\n🎬 First 8 streams delivered to Stremio:');
        for (const [idx, s] of streams.slice(0, 8).entries()) {
            console.log(`[${idx + 1}] ${s.name}`);
            console.log(`    Title: ${s.title.replace(/\n/g, ' ')}`);
            console.log(`    URL:   ${s.url.slice(0, 85)}...`);
        }
        if (streams.length === 0) {
            console.warn('⚠️ No streams returned. Check network or media availability.');
            process.exit(1);
        }
        process.exit(0);
    }
    catch (err) {
        console.error('❌ Test failed with error:', err);
        process.exit(1);
    }
}
main();
