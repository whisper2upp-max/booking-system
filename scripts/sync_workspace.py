"""Embed the maintained workspace JSX into the standalone offline entry point."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / 'app/booking system v3.6.html'
text = target.read_text(encoding='utf-8')
start = '// BEGIN V3 WORKSPACE'
end = '// END V3 WORKSPACE'
source = (root / 'src/workspace.jsx').read_text(encoding='utf-8') + '\n// PROJECT OVERVIEW TRIAL\n' + (root / 'src/project-overview.jsx').read_text(encoding='utf-8')
if start in text:
    first = text.index(start)
    last = text.index(end, first) + len(end)
else:
    first = text.index('function App(){')
    last = text.index('// ==================== MAIN PAGE', first)
text = text[:first] + start + '\n' + source + '\n' + end + '\n\n' + text[last:].lstrip('\n')
target.write_text(text, encoding='utf-8')
print('Workspace JSX synchronized.')
