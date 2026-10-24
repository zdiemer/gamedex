"""Folder discovery must not depend on a manifest, app includes, or demo registration."""
from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src'))
from component_catalog import inventory, catalogue_script


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


if __name__ == '__main__':
    unittest.main()
