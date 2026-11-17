import { MovyProvider } from './provider';

async function main() {
  const provider = new MovyProvider();
  const testId = process.argv[2] || 'tt1375666';
  const testType = process.argv[3] || (testId.includes(':') ? 'series' : 'movie');

  console.log(`\n🔍 Testing MovyProvider for ID: ${testId} (Type: ${testType})...`);

  try {
    const streams = await provider.getStreams(testType as any, testId);
    console.log(`✅ Success! Found ${streams.length} stream(s):\n`);
    for (const [idx, s] of streams.entries()) {
      console.log(`[${idx + 1}] ${s.name}`);
      console.log(`    Title: ${s.title.replace(/\n/g, ' ')}`);
      console.log(`    URL:   ${s.url.slice(0, 80)}...`);
      console.log(`    Hints: ${JSON.stringify(s.behaviorHints)}\n`);
    }

    if (streams.length === 0) {
      console.warn('⚠️ No streams returned. Check network or media availability.');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  }
}

main();
