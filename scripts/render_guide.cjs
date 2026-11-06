const fs=require('fs'),path=require('path');
const chapters=require('../app/usage-guide.js');
const lines=['# Booking System v3.5 使用说明','','程序内可通过顶部“使用说明”打开同一份内容，并按模块浏览或搜索。',''];
const tableCell=value=>String(value).replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>');
function renderSection(section,level=3){
  lines.push('#'.repeat(level)+' '+section.title,'');
  if(section.text)lines.push(section.text,'');
  if(section.details)lines.push(...section.details.flatMap(item=>[`**${item.label}：**${item.text}`,'']));
  if(section.steps)lines.push(...section.steps.map((s,i)=>`${i+1}. ${s}`),'');
  if(section.notes)lines.push(...section.notes.map(s=>'- '+s),'');
  if(section.subsections)section.subsections.forEach(sub=>renderSection(sub,level+1));
  if(section.tip)lines.push('> '+section.tip,'');
  if(section.table){
    const {headers,rows}=section.table;
    lines.push('| '+headers.map(tableCell).join(' | ')+' |','| '+headers.map(()=>'---').join(' | ')+' |',...rows.map(row=>'| '+row.map(tableCell).join(' | ')+' |'),'');
  }
}
chapters.forEach((chapter,index)=>{
  lines.push(`## ${index+1}. ${chapter.title}`,'',chapter.intro,'');
  chapter.sections.forEach(section=>renderSection(section));
});
fs.writeFileSync(path.join(__dirname,'../使用说明_v3.5.md'),lines.join('\n'));
console.log(`Generated ${chapters.length}-chapter v3.5 Markdown guide from the in-app content.`);
