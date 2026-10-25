import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {RuntimeClient} from './runtime-client.mjs';

const args = process.argv.slice(2);
let directory = process.env.FANSERVICE_RUNTIME_DIR;
if (args.length) {
  if (args.length !== 2 || args[0] !== '--runtime-dir') throw Error('Usage: node server.mjs --runtime-dir <absolute Fanservice mod directory>');
  directory = args[1];
}
const runtime = new RuntimeClient(directory);
const definitions = {
  native_status: {action: 'status', readOnly: true, idempotent: true,
    description: 'Read the connected packaged v0.04 game runtime status. Does not operate game controls.'},
  native_catalog: {action: 'catalog', readOnly: true, idempotent: true,
    description: 'Read authoritative native UP and fanservice pack ownership/enablement. Purchases and toggles remain in original Unlocks.'},
  native_profile: {action: 'profile', readOnly: true, idempotent: true,
    description: 'Read the active native profile binding and in-process identity. Does not edit saves.'},
  native_enable_fixture: {action: 'enablefixture', readOnly: false, idempotent: true,
    description: 'Enable only the fixed, already-owned synthetic test pack configured locally in mcp-test-pack.txt, through the original native backend. No purchase or UP grant.'},
  native_probe_video: {action: 'probevideo', readOnly: false, idempotent: false,
    description: 'Start the fixed localhost synthetic-video probe on a separate native decoder object. No UI input, age-screen interaction or caller-selected path/URL.'}
};
const server = new Server({name: 'fanservice-native-runtime', version: '0.1.0'}, {capabilities: {tools: {}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: Object.entries(definitions).map(([name, definition]) => ({
  name, description: definition.description, inputSchema: {type: 'object', properties: {}, additionalProperties: false},
  annotations: {readOnlyHint: definition.readOnly, destructiveHint: false, idempotentHint: definition.idempotent, openWorldHint: false}
}))}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const name = request.params.name;
  if (!Object.hasOwn(definitions, name) || Object.keys(request.params.arguments || {}).length) {
    return {isError: true, content: [{type: 'text', text: 'Unknown tool or unexpected arguments.'}]};
  }
  try {
    const result = await runtime.request(definitions[name].action, {signal: extra.signal});
    return {content: [{type: 'text', text: JSON.stringify(result)}], structuredContent: result};
  } catch (error) {
    return {isError: true, content: [{type: 'text', text: error.message}]};
  }
});
await server.connect(new StdioServerTransport());
