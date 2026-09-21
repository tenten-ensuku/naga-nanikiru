import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({Event});
vm.runInContext(fs.readFileSync(new URL('../public/comment-selection-v321.js',import.meta.url),'utf8'),context);
const {formatEdit,apply}=context.MinkiruCommentSelectionV321;

test('formatting only changes the selected Japanese text, preserving surrounding text, emoji and tile notation',()=>{
  const text='東ではなく🙂白を切る 7ｚ',start=text.indexOf('白'),end=start+4;
  for(const [kind,value,open,close] of [['bold','','**','**'],['spoiler','','||','||'],['color','red','[color:red]','[/color]'],['size','large','[size:large]','[/size]']]){
    const edit=formatEdit(text,start,end,kind,value);
    assert.equal(edit.value,text.slice(0,start)+open+text.slice(start,end)+close+text.slice(end));
    assert.equal(edit.value.slice(edit.start,edit.end),text.slice(start,end));
    const reset=formatEdit(edit.value,edit.start,edit.end,kind,value);
    assert.equal(reset.value,text);assert.equal(reset.start,start);assert.equal(reset.end,end);
  }
});

test('changing an existing text color replaces it and repeated use removes it',()=>{
  const first=formatEdit('文章です',0,2,'color','red');
  const second=formatEdit(first.value,first.start,first.end,'color','blue');
  assert.equal(second.value,'[color:blue]文章[/color]です');
  assert.equal(formatEdit(second.value,second.start,second.end,'color','blue').value,'文章です');
  const all='**[color:red]文章[/color]**';
  const changed=formatEdit(all,0,all.length,'color','green');
  assert.equal(changed.value,'**[color:green]文章[/color]**');
  assert.equal(changed.value.slice(changed.start,changed.end),'文章');
});

test('multiline spoiler and nested bold preserve each other when toggled',()=>{
  const text='7zを切る\n私はこう思う';
  const spoiler=formatEdit(text,0,text.length,'spoiler');
  const bold=formatEdit(spoiler.value,spoiler.start,spoiler.end,'bold');
  assert.equal(bold.value,'||**'+text+'**||');
  assert.equal(formatEdit(bold.value,bold.start,bold.end,'bold').value,spoiler.value);
  assert.equal(formatEdit('前**太字**後',1,7,'bold').value,'前太字後');
});

test('each selected style can be removed even after adding another style inside it',()=>{
  let edit=formatEdit('本文',0,2,'bold');
  edit=formatEdit(edit.value,edit.start,edit.end,'spoiler');
  edit=formatEdit(edit.value,edit.start,edit.end,'color','green');
  assert.equal(edit.value,'**||[color:green]本文[/color]||**');
  edit=formatEdit(edit.value,edit.start,edit.end,'bold');
  assert.equal(edit.value,'||[color:green]本文[/color]||');assert.equal(edit.active,true);
  edit=formatEdit(edit.value,edit.start,edit.end,'spoiler');
  assert.equal(edit.value,'[color:green]本文[/color]');
  edit=formatEdit(edit.value,edit.start,edit.end,'color','green');
  assert.equal(edit.value,'本文');assert.equal(edit.start,0);assert.equal(edit.end,2);
});

test('unsupported format values, stale offsets and exceeding the character limit do not change the draft',()=>{
  assert.equal(formatEdit('abc',0,3,'color','<script>'),null);
  assert.equal(formatEdit('abc',0,3,'size','giant'),null);
  assert.equal(formatEdit('abc',0,7,'bold'),null);
  assert.equal(formatEdit('abc',0,3,'bold','',6).tooLong,true);
  assert.equal(formatEdit('abc',0,3,'bold','',7).value,'**abc**');
});

function input(value='前選択後'){
  return {value,maxLength:2000,selectionStart:1,selectionEnd:3,scrollTop:80,scrollLeft:5,events:[],
    focus(options){this.focusOptions=options;},
    setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);},
    setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},
    dispatchEvent(event){this.events.push(event.type);}};
}
test('applying a saved selection restores the selected text and keeps scrolling, direction and input notifications',()=>{
  const node=input();node.selectionStart=node.selectionEnd=0;
  assert.equal(apply(node,'bold','',{text:node.value,start:1,end:3,direction:'backward'}),true);
  assert.equal(node.value,'前**選択**後');assert.equal(node.value.slice(node.selectionStart,node.selectionEnd),'選択');
  assert.equal(node.selectionDirection,'backward');assert.equal(node.focusOptions.preventScroll,true);
  assert.equal(node.scrollTop,80);assert.equal(node.scrollLeft,5);assert.deepEqual(node.events,['input']);
});
test('stale selection and read-only or sending editors cannot alter the text',()=>{
  for(const state of [{disabled:true},{readOnly:true},{range:{text:'old',start:1,end:3}}]){
    const node=Object.assign(input(),state);assert.equal(apply(node,'bold','',state.range),false);
    assert.equal(node.value,'前選択後');assert.deepEqual(node.events,[]);
  }
});
test('the existing non-selection formatting controls still insert an editable placeholder',()=>{
  const node=input('');node.selectionStart=node.selectionEnd=0;
  assert.equal(apply(node,'spoiler'),true);assert.equal(node.value,'||ここに文字||');
  assert.equal(node.value.slice(node.selectionStart,node.selectionEnd),'ここに文字');
});
