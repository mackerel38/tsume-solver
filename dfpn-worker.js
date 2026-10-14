/* Depth-first proof-number search for checking-move tsume. Worker only; MIT. */
'use strict';
importScripts('engine.js');
const E=self.Shogi;
const INF=1000000000;
let table, nodes, visits, hits, deadline, limit, started, attacker, reportAt, maxDepth, unlimited;
let zobBoard,zobHand,ha=0,hb=0;
function hashSetup(){
  let seed=0x9e3779b9;
  const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  zobBoard=Array.from({length:81},()=>Array.from({length:29},()=>[rnd(),rnd()]));
  zobHand=Array.from({length:2},()=>Array.from({length:8},()=>Array.from({length:256},()=>[rnd(),rnd()])));
}
hashSetup();
const xo=arr=>{ha=(ha^arr[0])>>>0;hb=(hb^arr[1])>>>0;};
function hashInit(s){ha=hb=0;for(let i=0;i<81;i++)if(s.board[i])xo(zobBoard[i][s.board[i]+14]);for(let c=0;c<2;c++)for(let t=1;t<=7;t++)xo(zobHand[c][t][s.hands[c][t]]);}
function move(s,m,side){
 const c=E.ownIndex(side),cap=s.board[m.to],old=m.from===-1?0:s.board[m.from];
 if(old)xo(zobBoard[m.from][old+14]);if(cap)xo(zobBoard[m.to][cap+14]);
 xo(zobBoard[m.to][side*(m.promote?E.PROMOTE[m.piece]:m.piece)+14]);
 if(m.from===-1){const n=s.hands[c][m.piece];xo(zobHand[c][m.piece][n]);xo(zobHand[c][m.piece][n-1]);}
 if(cap){const t=E.UNPROMOTE[Math.abs(cap)],n=s.hands[c][t];xo(zobHand[c][t][n]);xo(zobHand[c][t][n+1]);}
 return E.makeMove(s,m,side);
}
function undo(s,m,side,u){
 E.undoMove(s,m,side,u);
 const c=E.ownIndex(side),cap=u.captured,old=u.was;
 if(old)xo(zobBoard[m.from][old+14]);if(cap)xo(zobBoard[m.to][cap+14]);
 xo(zobBoard[m.to][side*(m.promote?E.PROMOTE[m.piece]:m.piece)+14]);
 if(m.from===-1){const n=s.hands[c][m.piece];xo(zobHand[c][m.piece][n]);xo(zobHand[c][m.piece][n-1]);}
 if(cap){const t=E.UNPROMOTE[Math.abs(cap)],n=s.hands[c][t];xo(zobHand[c][t][n]);xo(zobHand[c][t][n+1]);}
}
const key=side=>ha.toString(36)+'-'+hb.toString(36)+(side===1?'b':'w');
const sat=(a,b)=>a>=INF-b?INF:a+b;
function getNode(k){let e=table.get(k);if(e){hits++;return e;}return {pn:1,dn:1,children:null};}
function publish(){self.postMessage({type:'progress',algorithm:'dfpn',depth:unlimited?null:maxDepth,unlimited,nodes,hits,visits,entries:table.size,elapsed:Date.now()-started});}
function checkLimits(){
 if(visits%2048===0){
  const now=Date.now();
  if(now>=deadline)throw Error('time');
  if(nodes>=limit)throw Error('nodes');
  if(now>=reportAt){publish();reportAt=now+500;}
 }
}
function expand(s,side,rem,e){
 let moves;
 if(side===attacker){
  moves=rem>0?E.generateChecks(s,side):[];
  moves=moves.filter(m=>!(m.from===-1&&m.piece===1&&E.isPawnDropMate(s,m,side)));
 } else {
  moves=E.generateDefenses(s,side);
 }
 nodes++;
 if(!moves.length){
  e.children=[];
  if(side===attacker){e.pn=INF;e.dn=0;}else{e.pn=0;e.dn=INF;}
  return;
 }
 if(rem<=0){e.children=[];e.pn=INF;e.dn=0;return;}
 e.children=[];
 for(const m of moves){
  const u=move(s,m,side),childKey=key(-side),childId=childKey+':'+(unlimited?'*':(rem-1));
  undo(s,m,side,u);
  e.children.push({m,k:childKey,id:childId});
 }
}
// Values for an ancestor repetition are context-specific and must not be
// written into the transposition table as a solved global result.
function summarize(e,orNode,path,signature){
 let pn=orNode?INF:0,dn=orNode?0:INF;
 let best=-1,bestValue=INF,second=INF,cycle=false,bestPn=1,bestDn=1;
 for(let i=0;i<e.children.length;i++){
  const child=e.children[i];
  const repeated=path.has(child.k);
  const cached=getNode(child.id);
  const v=repeated?{pn:INF,dn:0,dependent:true}:(cached.pn===0 || cached.dn===0 ? cached:(child.local && child.local.signature===signature ? child.local:cached));
  if(repeated||v.dependent)cycle=true;
  if(orNode){pn=Math.min(pn,v.pn);dn=sat(dn,v.dn);}else{pn=sat(pn,v.pn);dn=Math.min(dn,v.dn);}
  const merit=orNode?v.pn:v.dn;
  if(merit<bestValue){second=bestValue;bestValue=merit;best=i;bestPn=v.pn;bestDn=v.dn;}
  else if(merit<second)second=merit;
 }
 return {pn,dn,best,second,cycle,bestPn,bestDn};
}
// Explicit search stack: JavaScript engines cannot safely recurse thousands of plies.
// Each visit gets a unique integer context token for local repetition decisions;
// do not retain frame objects in the transposition table for long searches.
function dfpn(s,side,rem,phi,delta){
 const stack=[{side,rem,phi,delta,stage:0,arrival:null}];
 const path=new Set();
 let last,frameToken=0;
 function finish(answer){
  const f=stack.pop();
  if(f.inPath)path.delete(f.pk);
  if(f.arrival){
   const a=f.arrival;
   undo(s,a.m,a.side,a.u);
   a.child.local=answer.dependent?{signature:stack[stack.length-1].token,pn:answer.pn,dn:answer.dn,dependent:true}:null;
  }
  last=answer;
 }
 while(stack.length){
  const f=stack[stack.length-1];
  if(f.stage===0){
   visits++;checkLimits();
   f.pk=key(f.side);
   if(path.has(f.pk)){finish({pn:INF,dn:0,dependent:true});continue;}
   const id=f.pk+':'+(unlimited?'*':f.rem);
   let e=table.get(id);
   if(!e){e={pn:1,dn:1,children:null,dependent:false};table.set(id,e);}
   if(e.children===null)expand(s,f.side,f.rem,e);
   if(!e.children.length){finish({pn:e.pn,dn:e.dn,dependent:false});continue;}
   f.e=e;f.isOr=f.side===attacker;f.stage=1;f.token=++frameToken;
   path.add(f.pk);f.inPath=true;
   continue;
  }
  visits++;checkLimits();
  const sum=summarize(f.e,f.isOr,path,f.token);
  const dep=sum.cycle&&sum.pn!==0;
  if(!dep||sum.pn===0){f.e.pn=sum.pn;f.e.dn=sum.dn;f.e.dependent=false;}
  else{f.e.dependent=true;f.e.pn=1;f.e.dn=1;}
  if(sum.pn===0||sum.dn===0||sum.pn>=f.phi||sum.dn>=f.delta||sum.best<0){
   finish({pn:sum.pn,dn:sum.dn,dependent:dep});
   continue;
  }
  const child=f.e.children[sum.best],oldPn=sum.bestPn,oldDn=sum.bestDn;
  const childPhi=f.isOr?Math.min(f.phi,sat(sum.second,1)):Math.max(1,f.phi-(sum.pn-oldPn));
  const childDelta=f.isOr?Math.max(1,f.delta-(sum.dn-oldDn)):Math.min(f.delta,sat(sum.second,1));
  const u=move(s,child.m,f.side);
  stack.push({side:-f.side,rem:unlimited?Infinity:f.rem-1,phi:childPhi,delta:childDelta,stage:0,
    arrival:{m:child.m,side:f.side,u,child}});
 }
 return last;
}
// Reconstruct a proven line without call-stack recursion. Try alternate proven
// children if one would revisit an ancestor. This returns one valid line,
// not necessarily the defender's longest possible resistance.
function reconstruct(s,side,rem){
 const stack=[{side,rem,stage:0,via:null}];
 const path=new Set(),pv=[];
 function backtrack(){
  const f=stack.pop();
  if(f.entered)path.delete(f.pk);
  if(f.via){undo(s,f.via.m,f.via.side,f.via.u);pv.pop();}
 }
 while(stack.length){
  const f=stack[stack.length-1];
  if(f.stage===0){
   f.pk=key(f.side);
   const e=table.get(f.pk+':'+(unlimited?'*':f.rem));
   if(!e||e.pn!==0||path.has(f.pk)){backtrack();continue;}
   if(e.children.length===0)return pv.slice();
   path.add(f.pk);f.entered=true;f.stage=1;f.index=0;
   f.choices=e.children.filter(c=>table.get(c.id)?.pn===0);
  }
  if(f.index>=f.choices.length){backtrack();continue;}
  const c=f.choices[f.index++];
  if(path.has(c.k))continue;
  const u=move(s,c.m,f.side);
  pv.push(c.m);
  stack.push({side:-f.side,rem:unlimited?Infinity:f.rem-1,stage:0,via:{m:c.m,side:f.side,u}});
 }
 throw Error('解答の再構築に失敗しました');
}
self.onmessage=event=>{
 if(event.data.type!=='solve')return;
 try{
  const opt=event.data;
  const base=E.parseSfen(opt.sfen),s=opt.defenderAll?E.fillDefenderHand(base):base;
  attacker=s.turn;
  if(s.kings[E.ownIndex(-attacker)]<0)throw Error('玉方の玉が盤上にありません');
  table=new Map();nodes=visits=hits=0;started=Date.now();
  const requested=Number(opt.depth);
  if(!Number.isSafeInteger(requested)||requested<0)throw Error('最大手数の設定が不正です');
  unlimited=requested===0;
  maxDepth=unlimited?Infinity:(requested%2===0?requested-1:requested);
  deadline=started+Math.max(1,Math.min(3600,Number(opt.seconds)||120))*1000;
  limit=Math.max(1000,Math.min(100000000,Number(opt.maxNodes)||5000000));
  reportAt=started+500;hashInit(s);
  const r=dfpn(s,attacker,maxDepth,INF,INF);
  const solved=r.pn===0;
  const pv=solved?reconstruct(s,attacker,maxDepth):[];
  self.postMessage({type:'done',algorithm:'dfpn',solved,pv,plies:solved?pv.length:null,depth:unlimited?null:maxDepth,unlimited,nodes,hits,visits,entries:table.size,elapsed:Date.now()-started,reason:solved?'mate':(unlimited?'disproof':'depth'),defenderHand:E.handLabel(s.hands[E.ownIndex(-attacker)])});
 }catch(err){
  const reason=err.message==='nodes'?'nodes':err.message==='time'?'time':'error';
  self.postMessage({type:reason==='error'?'error':'done',algorithm:'dfpn',solved:false,pv:[],plies:null,depth:unlimited?null:(maxDepth||0),unlimited:!!unlimited,nodes:nodes||0,visits:visits||0,hits:hits||0,entries:table?table.size:0,elapsed:Date.now()-(started||Date.now()),reason,message:reason==='nodes'?'探索局面数の上限に到達しました':reason==='time'?'時間上限に到達しました':err.message});
 }
};
