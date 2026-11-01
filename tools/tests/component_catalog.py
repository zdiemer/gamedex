"""Folder discovery must not depend on a manifest, app includes, or demo registration."""
from pathlib import Path
import json
import sys
import tempfile
import subprocess
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src'))
from component_catalog import inventory, catalogue_script, parse_contract


class DiscoveryTest(unittest.TestCase):
    def test_files_and_declarations_are_discovered_recursively(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                'controls/nested/new.js': 'export function NewControl() {}\nconst arrow =\n () => "new";',
                'other/new.js': 'export class NewControl {}',
                'unknown/unusual.mjs': 'export default () => "<span>hello</span>";',
                'unknown/card.html': '<article>Card</article>',
                'unknown/card.css': '.card { color: red }',
                'unknown/icon.svg': '<svg/>',
                'unknown/config.json': '{"title":"Example"}',
            }
            for file, content in files.items():
                path = root / 'components' / file
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            result = inventory(root)
            self.assertEqual({entry['file'] for entry in result}, {'components/'+file for file in files})
            self.assertIn('arrow', {entry['name'] for entry in result})
            self.assertEqual(len({entry['id'] for entry in result}), len(result))
            self.assertTrue(all(len(entry['id']) <= 120 for entry in result))
            self.assertEqual(result, inventory(root))
            script = catalogue_script(root)
            self.assertEqual(json.loads(script.split('const COMPONENT_SOURCES = ')[1].rstrip(';\n')), result)

    def test_moves_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root/'components'/'widgets'
            folder.mkdir(parents=True)
            file = folder/'one.js'
            file.write_text('const Widget = () => "";')
            old_id = inventory(root)[0]['id']
            file.rename(folder/'two.js')
            self.assertNotEqual(inventory(root)[0]['id'], old_id)
            secret = root/'outside.js'
            secret.write_text('function privateThing() {}')
            (folder/'outside.js').symlink_to(secret)
            self.assertEqual(len(inventory(root)), 1)



CONTRACT = """/**
 * @component Build a safe label.
 * Additional context on the next line.
 * @param {string} text - Visible label.
 * @param {Object} [options={}] - Options.
 * @param {boolean} [options.disabled=false] - Disabled state.
 * @returns {string} HTML.
 * @requires escapeHtml
 * @requires .label styles
 * @events Caller owns click handlers.
 * @cleanup No allocated resources.
 * @escaping Treat <img src=x onerror=alert(1)> as text.
 * @example
 * const html = label("Example", {
 *   disabled: true,
 * });
 * @example
 * label("Second example");
 */
"""


class ContractTest(unittest.TestCase):
    def test_structured_fields_and_multiline_examples(self):
        contract = parse_contract(CONTRACT[3:-3])
        self.assertNotIn('warnings', contract)
        self.assertIn('Additional context', contract['summary'])
        self.assertEqual(len(contract['params']), 3)
        self.assertIn('[options.disabled=false]', contract['params'][2])
        self.assertEqual(contract['requires'], ['escapeHtml', '.label styles'])
        self.assertEqual(contract['examples'][0], 'const html = label("Example", {\n  disabled: true,\n});')
        self.assertEqual(len(contract['examples']), 2)
        self.assertIn('<img', contract['escaping'])

    def test_contracts_follow_declarations_and_refresh_without_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'components' / 'nested' / 'label.mjs'
            file.parent.mkdir(parents=True)
            file.write_text(CONTRACT + 'export const label = text => text;\nfunction helper() {}\nthrow Error("Do not execute");')
            entries = inventory(root)
            self.assertEqual([entry['name'] for entry in entries], ['label', 'helper'])
            self.assertEqual(entries[0]['contract']['returns'], '{string} HTML.')
            self.assertNotIn('contract', entries[1])
            self.assertEqual(entries[0]['line'], len(CONTRACT.splitlines()) + 1)
            file.write_text(file.read_text().replace('Build a safe label.', 'Updated contract.'))
            self.assertIn('Updated contract.', inventory(root)[0]['contract']['summary'])
            # Another statement or intervening comment breaks immediate association.
            file.write_text(CONTRACT + '// unrelated\nfunction helper() {}')
            self.assertNotIn('contract', inventory(root)[0])

    def test_ordinary_docs_do_not_create_contracts_or_declarations(self):
        self.assertIsNone(parse_contract('A normal comment with @param in prose.'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'components'
            folder.mkdir()
            (folder / 'plain.js').write_text('/** Example:\nfunction fictional() {}\n*/\nfunction actual() {}')
            self.assertEqual([e['name'] for e in inventory(root)], ['actual'])

    def test_incomplete_contract_is_visible_but_fails_validation(self):
        broken = '/** @component Broken contract.\n * @unknown unsupported\n */\nfunction broken() {}'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'components'
            folder.mkdir()
            (folder / 'broken.js').write_text(broken)
            entry = inventory(root)[0]
            self.assertIn('Unknown contract tag: @unknown', entry['contract']['warnings'])
            self.assertIn('Missing contract field: cleanup', entry['contract']['warnings'])
            self.assertIn('broken', catalogue_script(root))
            command = Path(__file__).resolve().parents[1] / 'components' / 'catalog.py'
            check = subprocess.run([sys.executable, str(command), '--check', '--static-dir', directory], capture_output=True, text=True)
            self.assertNotEqual(check.returncode, 0)
            self.assertIn('Invalid component contract: components/broken.js:', check.stderr)

    def test_duplicate_singleton_fields_warn(self):
        contract = parse_contract(CONTRACT[3:-3] + '\n@cleanup Another cleanup.')
        self.assertIn('Use @cleanup only once', contract['warnings'])

    def test_shared_api_contracts_remain_complete(self):
        root = Path(__file__).resolve().parents[2] / 'static'
        contracts = [entry for entry in inventory(root) if 'contract' in entry]
        self.assertGreaterEqual(len(contracts), 28)
        for entry in contracts:
            self.assertNotIn('warnings', entry['contract'], entry['symbol'])

if __name__ == '__main__':
    unittest.main()
