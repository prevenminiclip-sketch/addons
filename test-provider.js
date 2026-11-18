const { MovyProvider } = require('./dist/provider');

async function test() {
  const provider = new MovyProvider();
  console.log('Testing movie tt1375666...');
  try {
    const target = provider.parseStremioId('movie', 'tt1375666');
    console.log('Target:', target);
    const meta = await provider.resolveMetadata(target);
    console.log('Meta:', meta);
    if (!meta) {
      console.log('FAILED TO RESOLVE METADATA!');
      return;
    }
    const serverResults = await provider.fetchAllSources(target, meta);
    console.log('Server results length:', serverResults ? serverResults.length : 0);
    const streams = await provider.getStreams('movie', 'tt1375666', 'http://localhost:7000');
    console.log('Streams found:', streams.length);
  } catch (err) {
    console.error('Error during test:', err);
  }
}

test();
