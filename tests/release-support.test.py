import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release_support', Path(__file__).parents[1] / 'scripts/release-support.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseSupportTests(unittest.TestCase):
    def files(self):
        return [Path(name) for name in (
            'LCSC-Library-Converter-Setup-0.2.0.exe',
            'LCSC-Library-Converter-0.2.0-win-x64.zip',
            'LCSC-Library-Converter-0.2.0-source.zip',
            'LCSC-Library-Converter-0.2.0-ad-dependency-source.zip',
            'SHA256SUMS.txt', 'plugin.eext')]

    def test_only_user_downloads_are_assets(self):
        assets, support = release.classify(self.files(), '0.2.0')
        self.assertEqual(len(assets), 3)
        self.assertEqual(len(support), 1)
        self.assertIn(Path('SHA256SUMS.txt'), assets)
        with self.assertRaises(ValueError):
            release.classify(self.files()[1:], '0.2.0')

    def test_notes_point_to_exact_version(self):
        _, support = release.classify(self.files(), '0.2.0')
        text = release.notes('owner/repo', 'v0.2.0', support)
        self.assertIn('release-support/v0.2.0/', text)
        self.assertIn('AD dependency corresponding source', text)
        self.assertNotIn('plugin.eext', text)
        self.assertNotIn('Project source for this version', text)
        self.assertNotIn('[SHA-256 checksums]', text)
        self.assertIn('Copy plugin folder', text)
        self.assertNotIn('需要', text)

    def test_new_branch_uses_separate_tree(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'source.zip'
            path.write_bytes(b'source')
            with patch.object(release, 'api', side_effect=[[], {'sha': 'main'}, {'sha': 'blob'},
                                                         {'sha': 'tree'}, {'sha': 'commit'}, {}]) as call:
                release.publish('owner/repo', 'v0.2.0', [path])
                self.assertEqual(call.call_args_list[-1].args[1], 'git/refs')
                self.assertEqual(call.call_args_list[-1].args[2]['ref'], 'refs/heads/release-support')
                self.assertNotIn('base_tree', call.call_args_list[3].args[2])

    def test_existing_source_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'source.zip'
            path.write_bytes(b'changed')
            replies = [[{'ref': 'refs/heads/release-support', 'object': {'sha': 'parent'}}],
                       {'tree': {'sha': 'tree'}},
                       {'tree': [{'path': 'v0.2.0/source.zip', 'sha': 'old', 'type': 'blob'}]}]
            with patch.object(release, 'api', side_effect=replies) as call:
                with self.assertRaisesRegex(ValueError, 'Refusing to overwrite'):
                    release.publish('owner/repo', 'v0.2.0', [path])
                self.assertEqual(call.call_count, 3)


if __name__ == '__main__':
    unittest.main()
