"""Build the end-user ZIP with an explicit allowlist; development files stay local."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--node', default=shutil.which('node'), help='Node used only while preparing the blank SG template')
parser.add_argument('--package-name', default='booking-system-v3.6', help='Output archive and distribution folder name')
args = parser.parse_args()
if Path(args.package_name).name != args.package_name:
    parser.error('Package name must be a filename, not a path')
if not args.node:
    parser.error('Pass --node with an available Node executable')

source = Path(__file__).resolve().parents[1]
project = source.parent
# Refuse to distribute any embedded personnel roster.
check = subprocess.run([args.node, '-e', "const s=require(process.argv[1]);if(s.master.length)throw Error('Release must not contain personnel master data');", str(source/'app/staff-master.js')],capture_output=True,text=True)
if check.returncode:
    raise SystemExit(check.stderr.strip())
distribution = project / '使用者分发' / ('v3.6' if args.package_name == 'booking-system-v3.6' else args.package_name)
archive_path = project / (args.package_name + '.zip')
runtime_files = [
    'booking system v3.6.html', 'refined-ui.css', 'staff-master.js',
    'workspace-store.js', 'auto-backup.js', 'team-data.js', 'usage-guide.js', 'react.production.min.js',
    'react-dom.production.min.js', 'babel.min.js', 'xlsx.full.min.js',
]
quick_start = '''Booking System v3.6 · 开始使用

1. 先把 ZIP 完整解压到一个固定文件夹，不要在压缩包内部直接打开程序。
2. 打开 app 文件夹，双击“booking system v3.6.html”。程序可离线使用，无需安装开发工具。
3. 页面顶部的“使用说明”提供 13 章详细指引，支持目录浏览和关键词搜索。
导入前请阅读“导入覆盖规则与模块导出”，确认替换范围及重复导入的结果；排班导入弹窗也可直接点击“查看覆盖规则”。

第一次使用
先在顶部“数据备份与恢复”设置 FIC / EIC 维护身份。FIC 定期导出自己的完整数据；EIC 用“导入 FIC 数据”按来源更新，不能以整份恢复代替团队汇总。自动备份与导出会带维护身份和时间戳。共享项目资料采用来源需要在导入预览中确认；排班按人员汇总。
进入 EIC 管理 → 排班管理，导入排班或选择财年后直接手动排班；无需先上传文件。
也可先导入预算，再在手动排班中选用预算项目。只有预算不会自动建立节点管理项目。
EIC 项目总览按项目集中查看节点、排班、预算、实际工时与 Task，可直接编辑并同步到其他模块。
程序不包含人员主数据或业务数据。首次使用请点击顶部“管理人员主数据”，下载模板填写 Name、Email、Level、FIC、EIC，再导入自己的名单。

包内文件
• app 文件夹：内含唯一程序入口 booking system v3.6.html 和必需依赖，请完整保留，不要单独移动其中的 HTML 或 JS 文件。
• booking template.xlsx：空白排班模板。
• SG+Booking格式.xlsx：空白排班小工具格式模板，仅保留表头；周列请按实际公司报表的期间替换。
预算、Timesheet 和节点模板可在程序对应的导入界面下载。

数据保存
业务数据保存在当前浏览器的本地存储中，日常请使用同一浏览器、同一用户和固定打开位置。
程序文件或此 ZIP 不包含你的排班数据，也不会让不同使用者自动共享排班。
浏览器清除站点数据或更换浏览器 / 打开位置可能导致原数据不可见。
首次打开在同一个窗口完成两步：先选择 FIC / EIC 维护身份并填写姓名，点击“下一步：备份文件夹”后选择目录。可暂时跳过；下次打开从尚未完成的步骤继续，已保存身份无需重填。设置后立即备份，此后网页运行期间每两小时保存一次，最多保留五份。顶部“数据备份与恢复”可修改目录、重新授权、立即备份及导入 JSON 恢复。
自动备份需要桌面版 Chrome / Edge 支持文件夹读写；关闭网页不能备份，休眠后恢复运行时补做一次。目录设置不绑定版本号，但须沿用同一浏览器、用户和打开位置；更换位置或清除站点数据可能需要重新选择。
保存后的业务操作可以在程序顶部撤销 / 重做，也可在“历史”中选择记录并点击“恢复到此步之后”。
在旧状态上进行新的业务修改，会清空后续重做记录；Task 草稿需要点击保存才会持久保留。
使用 OU 汇总时，通过程序已有的排班导出 / 导入交换相应数据。
'''

with tempfile.TemporaryDirectory(prefix='booking-user-package-') as temp:
    stage = Path(temp) / 'v3.6'
    (stage / 'app').mkdir(parents=True)
    for name in runtime_files:
        shutil.copy2(source / 'app' / name, stage / 'app' / name)
    documentation = ['README.md', '使用说明_v3.6.md', '更新日志_v3.6.md']
    documentation += [p.relative_to(source).as_posix() for p in sorted((source/'docs/images').glob('*.png'))]
    for name in documentation:
        (stage / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, stage / name)
    (stage / '开始使用.txt').write_text(quick_start, encoding='utf-8-sig')
    shutil.copy2(source / 'booking template.xlsx', stage / 'booking template.xlsx')

    # Generate a fresh workbook from the header only. Do not copy example staff,
    # bookings, comments, hidden sheets or the raw source workbook into the ZIP.
    script = r'''
try {
const fs=require('fs'),path=require('path');
const [source,dest]=process.argv.slice(1);
const XLSX=require(path.join(source,'app/xlsx.full.min.js'));
const wb=XLSX.read(fs.readFileSync(path.join(source,'SG+Booking格式.xlsx')),{type:'buffer'});
const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
const header=rows.find(row=>row.includes('员工姓名')&&row.includes('Engagement Code'));
if(!header)throw Error('SG header missing');
const ws=XLSX.utils.aoa_to_sheet([header]);
ws['!cols']=header.map((_,i)=>({wch:i===3?30:i>=7?28:20}));
const clean=XLSX.utils.book_new();XLSX.utils.book_append_sheet(clean,ws,'Booking');
fs.writeFileSync(path.join(dest,'SG+Booking格式.xlsx'),XLSX.write(clean,{type:'buffer',bookType:'xlsx'}));
for(const name of ['booking template.xlsx','SG+Booking格式.xlsx']){
 const test=XLSX.read(fs.readFileSync(path.join(dest,name)),{type:'buffer'});
 if(test.SheetNames.length!==1)throw Error('Unexpected template sheet');
 const values=XLSX.utils.sheet_to_json(test.Sheets[test.SheetNames[0]],{header:1,defval:''});
 if(values.length!==1)throw Error('Template contains non-header rows');
}
} catch(e) { console.error(e.message); process.exit(1); }
'''
    result = subprocess.run([args.node, '-e', script, str(source), str(stage)], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(result.stderr.strip())

    html = (stage / 'app/booking system v3.6.html').read_text(encoding='utf-8')
    references = re.findall(r'<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"', html)
    assert set(references) == set(runtime_files) - {'booking system v3.6.html'}
    for name in runtime_files:
        assert (stage/'app'/name).read_bytes() == (source/'app'/name).read_bytes()

    expected = {'app/'+name for name in runtime_files} | {
        '开始使用.txt', 'booking template.xlsx', 'SG+Booking格式.xlsx'
    } | set(documentation)
    files = sorted(p for p in stage.rglob('*') if p.is_file())
    assert {p.relative_to(stage).as_posix() for p in files} == expected
    temporary_archive = Path(temp) / archive_path.name
    with zipfile.ZipFile(temporary_archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in files:
            archive.write(file, 'v3.6/'+file.relative_to(stage).as_posix())
    with zipfile.ZipFile(temporary_archive) as archive:
        assert len(archive.infolist()) == len(expected)
        for file in files:
            assert archive.read('v3.6/'+file.relative_to(stage).as_posix()) == file.read_bytes()

    distribution.parent.mkdir(exist_ok=True)
    if distribution.exists():
        # This directory is owned by this packager; never touch the development copy.
        shutil.rmtree(distribution)
    shutil.copytree(stage, distribution)
    os.replace(temporary_archive, archive_path)

sha = hashlib.sha256(archive_path.read_bytes()).hexdigest()
archive_path.with_suffix('.zip.sha256').write_text(sha+'  '+archive_path.name+'\n')
print(json.dumps({'archive':str(archive_path),'distribution':str(distribution),'files':len(expected),
                  'bytes':archive_path.stat().st_size,'sha256':sha,'runtime':'matches source byte-for-byte'},ensure_ascii=False))
