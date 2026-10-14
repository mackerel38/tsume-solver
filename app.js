/* GitHub Pages UI, local persistence, and search orchestration. MIT license. */
(function(){
'use strict';
const E=window.Shogi;
const SAMPLE='8k/6G2/7G1/9/9/9/9/9/9 b R 1';
const KEY='sfen-tsume-library-v1';
const $=id=>document.getElementById(id);
let sourceState=null,displayState=null,steps=[],step=0,activeResult=null,worker=null,savedEditId=null,previewTimer=null;
let saved=[];
let editMode=false,editorState=null,editorTool={kind:'piece',type:1},moveFrom=-1;
function loadSaved(){try{const v=JSON.parse(localStorage.getItem(KEY)||'[]');saved=Array.isArray(v)?v.filter(x=>x&&typeof x.sfen==='string'&&typeof x.name==='string').slice(0,2000):[];}catch(e){saved=[];showStatus('保存データを読み込めませんでした。','error');}}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(saved));return true;}catch(e){showStatus('ブラウザの保存容量または設定により保存できませんでした。','error');return false;}}
function showStatus(text,kind=''){const node=$('status');node.textContent=text;node.className='status'+(kind?' '+kind:'');}
function niceInt(n){return Number(n||0).toLocaleString('ja-JP');}
function updateMetrics(data){$('metrics').hidden=false;$('metrics').replaceChildren();const v=[`探索 ${niceInt(data.nodes)} 局面`,`TTヒット ${niceInt(data.hits)}`,`経過 ${((data.elapsed||0)/1000).toFixed(2)} 秒`];if(data.unlimited)v.unshift('手数制限なし');else if(data.depth)v.unshift(data.algorithm==='dfpn'?`上限 ${data.depth} 手`:`${data.depth} 手まで完了`);if(data.entries!=null)v.push(`記憶局面 ${niceInt(data.entries)}`);for(const item of v){let span=document.createElement('span');span.textContent=item;$('metrics').append(span);}}
function defenderAll(){return $('allPieces').checked;}
function materialState(){const parsed=E.parseSfen($('sfenInput').value);return defenderAll()?E.fillDefenderHand(parsed):parsed;}
function drawBoard(){
 const area=$('board');area.replaceChildren();
 if(!displayState){$('whiteHand').textContent='–';$('blackHand').textContent='–';return;}
 const movesLast=step>0?steps[step-1]:null;
 for(let i=0;i<81;i++){
   const sq=document.createElement(editMode?'button':'div');sq.className='sq';
   if(editMode){sq.type='button';sq.classList.add('editable');sq.setAttribute('aria-label',`${9-i%9}筋${(i/9|0)+1}段：${displayState.board[i]?(displayState.board[i]>0?'先手':'後手')+E.NAMES[Math.abs(displayState.board[i])]:'空き'}`);sq.addEventListener('click',()=>editSquare(i));sq.addEventListener('contextmenu',e=>{e.preventDefault();if(editorState){editorState.board[i]=0;moveFrom=-1;syncEditor();}});sq.addEventListener('dragover',e=>e.preventDefault());sq.addEventListener('drop',e=>{e.preventDefault();const from=Number(e.dataTransfer?.getData('text/x-shogi-square'));if(Number.isInteger(from)&&from>=0&&from<81&&from!==i&&editorState?.board[from]){editorState.board[i]=editorState.board[from];editorState.board[from]=0;moveFrom=-1;syncEditor();}});if(displayState.board[i]){sq.draggable=true;sq.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/x-shogi-square',String(i));e.dataTransfer.effectAllowed='move';});}if(moveFrom===i)sq.classList.add('movingfrom');}
   if(movesLast&&movesLast.from===i)sq.classList.add('lastfrom');
   if(movesLast&&movesLast.to===i)sq.classList.add('lastto');
   const p=displayState.board[i];if(p){const t=Math.abs(p),span=document.createElement('span');span.className='piece'+(p<0?' opposite':'')+(t>=9?' promoted':'');span.textContent=E.NAMES[t];sq.append(span);}
   area.append(sq);
 }
 $('blackHand').textContent=E.handLabel(displayState.hands[0]);$('whiteHand').textContent=E.handLabel(displayState.hands[1]);
}
function setStep(n){
 if(editMode){step=0;displayState=editorState;drawBoard();$('stepIndicator').textContent='盤面編集中';return;}
 if(!sourceState)return;
 step=Math.max(0,Math.min(steps.length,n));displayState=E.cloneState(sourceState);
 let side=sourceState.turn;
 for(let i=0;i<step;i++){E.makeMove(displayState,steps[i],side);side=-side;}
 drawBoard();$('stepSlider').max=String(steps.length);$('stepSlider').value=String(step);$('stepIndicator').textContent=`${step} / ${steps.length} 手`;
 for(const [i,b]of [...$('moves').querySelectorAll('button.move')].entries())b.classList.toggle('active',i===step-1);
}
function renderSteps(){const area=$('moves');area.replaceChildren();area.className='movelist'+(steps.length?'':' empty');if(!steps.length){area.textContent='解答手順はありません。';$('copyMovesButton').disabled=true;return;}
 let side=sourceState.turn;
 steps.forEach((m,i)=>{const b=document.createElement('button');b.type='button';b.className='move';const num=document.createElement('small');num.textContent=`${i+1}.`;b.append(num,document.createTextNode(E.japaneseMove(m,side)));b.title=E.usiMove(m);b.addEventListener('click',()=>setStep(i+1));area.append(b);side=-side;});
 $('copyMovesButton').disabled=false;
}
function clearResult(){steps=[];activeResult=null;renderSteps();setStep(0);$('resultText').textContent='探索結果はここに表示されます。';$('resultText').className='resultText';$('metrics').hidden=true;}
function loadPreview(clear=true){
 try{const raw=E.parseSfen($('sfenInput').value);sourceState=defenderAll()?E.fillDefenderHand(raw):raw;if(editMode){editorState=raw;$('editorTurn').value=String(raw.turn);}if(clear)clearResult();else setStep(0);if(editMode){displayState=editorState;renderEditorHands();}drawBoard();if(!worker)showStatus('SFENを読み込みました。探索を開始できます。');return true;}
 catch(err){sourceState=null;displayState=editMode?editorState:null;steps=[];drawBoard();$('stepIndicator').textContent=editMode?'盤面編集中':'初期局面';if(!worker)showStatus(err.message,'error');return false;}
}
function stopSolver(){if(worker){worker.terminate();worker=null;$('solveButton').disabled=false;$('stopButton').disabled=true;return true;}return false;}
function complete(result){activeResult=result;steps=result.pv||[];renderSteps();setStep(steps.length);
 if(result.solved){$('resultText').className='resultText solved';$('resultText').textContent=`${result.plies}手詰を検出しました。表示中の手順は詰みに至る一例です（最長抵抗とは限りません）。`;showStatus(`${result.plies}手詰を検出しました。`, 'ok');}
 else { $('resultText').className='resultText'; const reason=result.reason==='nodes'?'探索局面数の上限に達しました。':result.reason==='time'?'制限時間に達しました。':result.reason==='disproof'?'手数制限なしの探索で詰みを証明できませんでした。':`${result.depth}手以内では詰みを確認できませんでした。`;
 $('resultText').textContent=reason+' 詰まないことが証明されたわけではありません。';showStatus(reason,'');}
 updateMetrics(result);
}
function beginSolve(){stopSolver();if(editMode)exitEditor();if(!loadPreview())return;clearResult();
 const algorithm=$('algorithmInput').value, depth=Number($('depthInput').value);
 if(algorithm==='dfs'&&(depth===0||depth>99)){showStatus('反復深化は99手までです。長手数または無制限にはDFPN系を選んでください。','error');return;}
 let w=new Worker(algorithm==='dfpn'?'dfpn-worker.js':'solver-worker.js');worker=w;
 const payload={type:'solve',algorithm,sfen:sourceState.source,defenderAll:defenderAll(),seconds:Number($('secondsInput').value),depth,maxNodes:Number($('nodesInput').value)};
 $('solveButton').disabled=true;$('stopButton').disabled=false;showStatus(algorithm==='dfpn'?(depth===0?'探索中：手数制限なしのDFPN系探索です。':'探索中：DFPN系探索で詰みを証明しています。'):'探索中：1手詰から反復深化しています。','busy');$('resultText').textContent='探索中…';
 w.onmessage=ev=>{if(worker!==w)return;const data=ev.data;if(data.type==='progress'){updateMetrics(data);showStatus(data.algorithm==='dfpn'?`DFPN系探索中：${niceInt(data.nodes)}局面展開。`: `${data.depth}手まで探索完了。さらに深い手数を調べています。`,'busy');return;}
   stopSolver();if(data.type==='error'){showStatus(data.message||'探索エラー','error');$('resultText').textContent='探索に失敗しました。';return;}
   complete({...data,defenderAll:payload.defenderAll,sfen:payload.sfen});};
 w.onerror=ev=>{if(worker!==w)return;stopSolver();showStatus(`ワーカーでエラーが発生しました: ${ev.message}`,'error');};
 w.postMessage(payload);
}
function saveCurrent(){
 let parsed;
 try{parsed=materialState();}catch(err){showStatus(err.message,'error');return;}
 if(!sourceState||sourceState.source!==parsed.source||defenderAll()!==!!(activeResult?.defenderAll??defenderAll())){
   sourceState=parsed;
   clearResult();
 }
 const name=$('nameInput').value.trim();if(!name){showStatus('保存する問題名を入力してください。','error');$('nameInput').focus();return;}
 const normalized=sourceState.source;
 // Disallow attaching a prior result to an edited SFEN or different hand setting.
 const validResult=activeResult&&activeResult.sfen===normalized&&activeResult.defenderAll===defenderAll()?activeResult:null;
 const now=new Date().toISOString();
 const existing=saved.find(x=>x.id===savedEditId);
 const item={id:existing?existing.id:(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random()),name,sfen:normalized,defenderAll:defenderAll(),result:validResult,settings:{algorithm:$('algorithmInput').value,depth:$('depthInput').value,seconds:$('secondsInput').value,maxNodes:$('nodesInput').value},createdAt:existing?existing.createdAt:now,updatedAt:now};
 if(existing)Object.assign(existing,item);else saved.unshift(item);
 if(persist()){savedEditId=item.id;renderLibrary();showStatus(`「${name}」をブラウザに保存しました。`,'ok');}
}
function restoreItem(item){stopSolver();if(editMode)exitEditor();$('sfenInput').value=item.sfen;$('nameInput').value=item.name;$('allPieces').checked=!!item.defenderAll;$('sfenPieces').checked=!item.defenderAll;
 if(item.settings){for(const [id,key] of [['algorithmInput','algorithm'],['depthInput','depth'],['secondsInput','seconds'],['nodesInput','maxNodes']]){const select=$(id),v=String(item.settings[key]||'');if([...select.options].some(o=>o.value===v))select.value=v;}}
 savedEditId=item.id;if(!loadPreview())return;
 if(item.result){activeResult=item.result;steps=item.result.pv||[];renderSteps();setStep(steps.length);$('resultText').textContent=item.result.solved?`${item.result.plies}手詰（保存された解答）`:'未解決（探索履歴を保存）';$('resultText').className='resultText'+(item.result.solved?' solved':'');updateMetrics(item.result);}
 $('inputTitle').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderLibrary(){
 const needle=$('searchInput').value.trim().toLowerCase();const area=$('savedItems');area.replaceChildren();$('savedCount').textContent=String(saved.length);
 const filtered=saved.filter(x=>x.name.toLowerCase().includes(needle)||x.sfen.toLowerCase().includes(needle));
 if(!filtered.length){const msg=document.createElement('p');msg.className='emptyLibrary';msg.textContent=needle?'一致する保存問題がありません。':'保存した問題はまだありません。';area.append(msg);return;}
 for(const item of filtered){const card=document.createElement('article');card.className='savedCard';const title=document.createElement('div');title.className='savedTitle';title.textContent=item.name;
 const status=document.createElement('div');status.className='savedStatus';const date=new Date(item.updatedAt).toLocaleString('ja-JP');status.textContent=`${item.result?(item.result.solved?`${item.result.plies}手詰`:'未解決'):'未探索'} · ${date}`;
 const sfen=document.createElement('div');sfen.className='savedSfen';sfen.textContent=item.sfen;
 const buttons=document.createElement('div');buttons.className='savedCardActions';const open=document.createElement('button');open.className='secondary';open.textContent='開く';open.addEventListener('click',()=>restoreItem(item));const remove=document.createElement('button');remove.className='delete';remove.textContent='削除';remove.addEventListener('click',()=>{if(!confirm(`「${item.name}」を削除しますか？`))return;saved=saved.filter(x=>x.id!==item.id);if(savedEditId===item.id)savedEditId=null;if(persist())renderLibrary();});buttons.append(open,remove);card.append(title,status,sfen,buttons);area.append(card);}
}
function exportAll(){const data={format:'sfen-tsume-library',version:1,exportedAt:new Date().toISOString(),items:saved};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`tsume-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
async function importAll(file){try{if(file.size>10*1024*1024)throw Error('10MB以下のJSONを選択してください');const data=JSON.parse(await file.text());if(data.format!=='sfen-tsume-library'||data.version!==1||!Array.isArray(data.items))throw Error('対応しているバックアップ形式ではありません');
 let n=0;for(const x of data.items.slice(0,2000)) {if(typeof x.name!=='string'||typeof x.sfen!=='string'||x.name.length>80)continue;try{E.parseSfen(x.sfen);}catch{continue;}
 const id=typeof x.id==='string'?x.id:String(Date.now())+Math.random();if(saved.some(z=>z.id===id))continue;saved.push({id,name:x.name,sfen:x.sfen,defenderAll:!!x.defenderAll,result:x.result&&typeof x.result==='object'?x.result:null,settings:x.settings&&typeof x.settings==='object'?x.settings:null,createdAt:x.createdAt||new Date().toISOString(),updatedAt:x.updatedAt||new Date().toISOString()});n++;}
 if(persist()){renderLibrary();showStatus(`${n}件の問題を取り込みました。`,'ok');}
 }catch(err){showStatus('読込失敗：'+err.message,'error');}}
function handleFile(file){if(!file)return;if(file.size>500000){showStatus('500KB以下のSFENテキストファイルを選択してください','error');return;}file.text().then(text=>{$('sfenInput').value=text;stopSolver();savedEditId=null;loadPreview();}).catch(e=>showStatus('ファイルの読込に失敗しました: '+e.message,'error'));}

// Editing works on the literal (unfilled) SFEN. Search state is separate.
function setEditorTool(kind,type){editorTool={kind,type};moveFrom=-1;renderEditorPalette();drawBoard();}
function renderEditorPalette(){
 const p=$('editorPalette');p.replaceChildren();
 for(let type=1;type<=14;type++){
  const b=document.createElement('button');b.type='button';b.className='palettePiece'+(editorTool.kind==='piece'&&editorTool.type===type?' selected':'');b.textContent=E.NAMES[type];b.title=`${$('editorSide').value==='1'?'先手':'後手'}の${E.NAMES[type]}を配置`;
  b.addEventListener('click',()=>setEditorTool('piece',type));p.append(b);
 }
 for(const [id,kind] of [['toolMove','move'],['toolErase','erase']])$(id).classList.toggle('selected',editorTool.kind===kind);
}
function renderEditorHands(){
 if(!editorState)return;
 const area=$('editorHands');area.replaceChildren();
 for(const side of [1,-1]){
  const group=document.createElement('div');group.className='editorHandGroup';
  const title=document.createElement('strong');title.textContent=side===1?'▲ 先手の持駒':'△ 後手の持駒';group.append(title);
  for(const type of [7,6,5,4,3,2,1]){
   const row=document.createElement('div');row.className='editorHandRow';
   const name=document.createElement('span');name.textContent=E.NAMES[type];
   const count=document.createElement('b');count.textContent=String(editorState.hands[E.ownIndex(side)][type]);
   const decrement=document.createElement('button');decrement.type='button';decrement.textContent='−';decrement.setAttribute('aria-label',`${side===1?'先手':'後手'}${E.NAMES[type]}を減らす`);
   const increment=document.createElement('button');increment.type='button';increment.textContent='＋';increment.setAttribute('aria-label',`${side===1?'先手':'後手'}${E.NAMES[type]}を増やす`);
   decrement.disabled=!editorState.hands[E.ownIndex(side)][type];increment.disabled=editorState.hands[E.ownIndex(side)][type]>=E.TOTAL[type];
   decrement.addEventListener('click',()=>{editorState.hands[E.ownIndex(side)][type]--;syncEditor();});
   increment.addEventListener('click',()=>{editorState.hands[E.ownIndex(side)][type]++;syncEditor();});
   row.append(name,decrement,count,increment);group.append(row);
  }
  area.append(group);
 }
}
function editSquare(i){
 if(!editMode||!editorState)return;
 if(editorTool.kind==='move'){
  if(moveFrom===-1){if(editorState.board[i]){moveFrom=i;drawBoard();}return;}
  if(moveFrom===i){moveFrom=-1;drawBoard();return;}
  editorState.board[i]=editorState.board[moveFrom];editorState.board[moveFrom]=0;moveFrom=-1;
 }else if(editorTool.kind==='erase')editorState.board[i]=0;
 else{
  const side=Number($('editorSide').value),type=editorTool.type;
  if(type===8){for(let j=0;j<81;j++)if(j!==i && editorState.board[j]===side*8)editorState.board[j]=0;}
  editorState.board[i]=side*type;
 }
 syncEditor();
}
function syncEditor(){
 if(!editorState)return;
 stopSolver();$('sfenInput').value=E.toSfen(editorState);
 try{sourceState=materialState();showStatus('SFENに反映しました。編集後に「解く」または「保存」を押してください。');}
 catch(e){sourceState=null;showStatus(`SFENを修正してください：${e.message}`,'error');}
 steps=[];activeResult=null;renderSteps();$('resultText').textContent='盤面を編集しました。探索結果はクリアされました。';$('resultText').className='resultText';$('metrics').hidden=true;
 displayState=editorState;step=0;$('stepIndicator').textContent='盤面編集中';$('stepSlider').value='0';$('stepSlider').max='0';drawBoard();renderEditorHands();
}
function enterEditor(){
 stopSolver();
 try{editorState=E.parseSfen($('sfenInput').value);}catch(e){showStatus('盤面編集には有効なSFENが必要です：'+e.message,'error');return;}
 editMode=true;moveFrom=-1;
 $('editorPanel').hidden=false;$('editorToggle').setAttribute('aria-expanded','true');$('editorToggle').textContent='編集を終了';
 $('editorTurn').value=String(editorState.turn);renderEditorPalette();renderEditorHands();
 clearResult();displayState=editorState;drawBoard();$('stepIndicator').textContent='盤面編集中';
}
function exitEditor(){
 if(!editMode)return;
 editMode=false;editorState=null;moveFrom=-1;$('editorPanel').hidden=true;
 $('editorToggle').setAttribute('aria-expanded','false');$('editorToggle').textContent='盤面を編集';loadPreview();
}
$('editorToggle').addEventListener('click',()=>editMode?exitEditor():enterEditor());
$('editorDone').addEventListener('click',exitEditor);
$('editorSide').addEventListener('change',()=>renderEditorPalette());
$('editorTurn').addEventListener('change',e=>{if(editorState){editorState.turn=Number(e.target.value);syncEditor();}});
$('toolMove').addEventListener('click',()=>setEditorTool('move',0));
$('toolErase').addEventListener('click',()=>setEditorTool('erase',0));
$('toolEmpty').addEventListener('click',()=>{if(!editorState||!confirm('盤上の駒をすべて削除しますか？（持駒はそのまま）'))return;editorState.board.fill(0);moveFrom=-1;syncEditor();});
$('editorCopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('sfenInput').value);showStatus('現在のSFENをコピーしました。','ok');}catch{showStatus('コピーできませんでした。SFEN欄からコピーしてください。','error');}});

$('sampleButton').addEventListener('click',()=>{$('sfenInput').value=SAMPLE;$('nameInput').value='サンプル・1手詰';stopSolver();savedEditId=null;loadPreview();});
$('fileInput').addEventListener('change',e=>{handleFile(e.target.files[0]);e.target.value='';});
const input=$('sfenInput');input.addEventListener('input',()=>{stopSolver();savedEditId=null;clearTimeout(previewTimer);previewTimer=setTimeout(()=>loadPreview(),250);});
input.addEventListener('dragover',e=>e.preventDefault());input.addEventListener('drop',e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);});
for(const input of document.querySelectorAll('input[name=defender]'))input.addEventListener('change',()=>{stopSolver();loadPreview();});
$('solveButton').addEventListener('click',beginSolve);$('stopButton').addEventListener('click',()=>{stopSolver();showStatus('探索を中断しました。');$('resultText').textContent='中断しました。';});
$('saveButton').addEventListener('click',saveCurrent);
$('firstButton').addEventListener('click',()=>setStep(0));$('prevButton').addEventListener('click',()=>setStep(step-1));$('nextButton').addEventListener('click',()=>setStep(step+1));$('lastButton').addEventListener('click',()=>setStep(steps.length));$('stepSlider').addEventListener('input',e=>setStep(Number(e.target.value)));
$('copyMovesButton').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(steps.map(E.usiMove).join(' '));showStatus('USI形式の読み筋をコピーしました。','ok');}catch{showStatus('クリップボードにコピーできませんでした。','error');}});
$('searchInput').addEventListener('input',renderLibrary);$('exportButton').addEventListener('click',exportAll);$('importInput').addEventListener('change',e=>{importAll(e.target.files[0]);e.target.value='';});
loadSaved();renderLibrary();$('sfenInput').value=SAMPLE;loadPreview();
})();
