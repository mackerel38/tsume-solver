/* Depth-bounded AND/OR checkmate search in a dedicated Web Worker. MIT license. */
'use strict';
importScripts('engine.js');
const E=self.Shogi;
let nodes=0, hits=0, tt, deadline=0, maxNodes=0, attacker=1, lastReport=0;
const FAIL={win:false,cycle:false};
let zobBoard, zobHand;
let hashA=0, hashB=0;
function randomTables() {
  let seed=0x9e3779b9;
  function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
  zobBoard=Array.from({length:81},()=>Array.from({length:29},()=>[rand(),rand()]));
  zobHand=Array.from({length:2},()=>Array.from({length:8},()=>Array.from({length:256},()=>[rand(),rand()])));
}
randomTables();
function xo(a){hashA=(hashA^a[0])>>>0;hashB=(hashB^a[1])>>>0;}
function initHash(s){hashA=0;hashB=0;for(let i=0;i<81;i++)if(s.board[i])xo(zobBoard[i][s.board[i]+14]);for(let c=0;c<2;c++)for(let t=1;t<=7;t++)xo(zobHand[c][t][s.hands[c][t]]);}
function hashedMove(s,m,side) {
  const ci=E.ownIndex(side),to=s.board[m.to];
  const old=m.from===-1?0:s.board[m.from];
  if(old)xo(zobBoard[m.from][old+14]);
  if(to)xo(zobBoard[m.to][to+14]);
  xo(zobBoard[m.to][side*(m.promote?E.PROMOTE[m.piece]:m.piece)+14]);
  if(m.from===-1){const n=s.hands[ci][m.piece];xo(zobHand[ci][m.piece][n]);xo(zobHand[ci][m.piece][n-1]);}
  if(to) {const t=E.UNPROMOTE[Math.abs(to)],n=s.hands[ci][t];xo(zobHand[ci][t][n]);xo(zobHand[ci][t][n+1]);}
  const u=E.makeMove(s,m,side);
  return u;
}
function hashedUndo(s,m,side,u){
  E.undoMove(s,m,side,u);
  const ci=E.ownIndex(side),old=u.was,cap=u.captured;
  if(old)xo(zobBoard[m.from][old+14]);
  if(cap)xo(zobBoard[m.to][cap+14]);
  xo(zobBoard[m.to][side*(m.promote?E.PROMOTE[m.piece]:m.piece)+14]);
  if(m.from===-1){const n=s.hands[ci][m.piece];xo(zobHand[ci][m.piece][n]);xo(zobHand[ci][m.piece][n-1]);}
  if(cap){const t=E.UNPROMOTE[Math.abs(cap)],n=s.hands[ci][t];xo(zobHand[ci][t][n]);xo(zobHand[ci][t][n+1]);}
}
function hashKey(side){return `${hashA.toString(36)}-${hashB.toString(36)}${side===1?'b':'w'}`;}
function search(s,side,remaining,path) {
  ++nodes;
  if((nodes&1023)===0){
    if(nodes>=maxNodes)throw Error('nodes');
    if(Date.now()>=deadline)throw Error('time');
  }
  const key=hashKey(side);
  if(path.has(key))return {win:false,cycle:true};
  const cacheKey=key+':'+remaining;
  let cached=tt.get(cacheKey);
  if(cached){hits++;return cached;}
  path.add(key);
  let result;
  if(side===attacker) {
    if(remaining===0){result=FAIL;}
    else {
      const moves=E.generateChecks(s,side);
      let best=null,mayCycle=false;
      for(const m of moves) {
        if(m.from===-1&&m.piece===1&&E.isPawnDropMate(s,m,side))continue;
        const u=hashedMove(s,m,side);
        const child=search(s,-side,remaining-1,path);
        hashedUndo(s,m,side,u);
        if(child.win) {
          const cand={win:true,plies:child.plies+1,pv:[m,...child.pv]};
          if(!best||cand.plies<best.plies)best=cand;
          // Cannot improve on mating in 1 ply.
          if(cand.plies===1)break;
        } else if(child.cycle)mayCycle=true;
      }
      result=best||{win:false,cycle:mayCycle};
    }
  }else {
    const moves=E.generateDefenses(s,side);
    if(moves.length===0)result={win:true,plies:0,pv:[]};
    else if(remaining===0)result=FAIL;
    else {
      let worst=null,failed=false,cycle=false;
      for(const m of moves) {
        const u=hashedMove(s,m,side);
        const child=search(s,-side,remaining-1,path);
        hashedUndo(s,m,side,u);
        if(!child.win){failed=true;cycle=!!child.cycle;break;}
        const cand={win:true,plies:child.plies+1,pv:[m,...child.pv]};
        if(!worst||cand.plies>worst.plies)worst=cand;
      }
      result=failed?{win:false,cycle}:worst;
    }
  }
  path.delete(key);
  // Failures relying on a cycle are path-dependent and cannot be memoized.
  if(!result.cycle && tt.size<230000)tt.set(cacheKey,result);
  return result;
}
self.onmessage=function(event){
  if(event.data.type!=='solve')return;
  try {
    const request=event.data;
    const base=E.parseSfen(request.sfen);
    const s=request.defenderAll?E.fillDefenderHand(base):base;
    attacker=s.turn;
    if(s.kings[E.ownIndex(-attacker)]<0)throw Error('玉方の玉が盤上にありません');
    nodes=0;hits=0;tt=new Map();
    maxNodes=Math.max(1000,Math.min(100000000,Number(request.maxNodes)||1500000));
    deadline=Date.now()+Math.max(1,Math.min(3600,Number(request.seconds)||15))*1000;
    initHash(s);
    const start=Date.now(),depthMax=Math.min(99,Math.max(1,Number(request.depth)||17));
    let best=null,finishedDepth=0;
    for(let depth=1;depth<=depthMax;depth+=2) {
      const r=search(s,attacker,depth,new Set());
      finishedDepth=depth;
      const info={type:'progress',depth,nodes,hits,elapsed:Date.now()-start};
      self.postMessage(info);
      if(r.win){best=r;break;}
      if(Date.now()>=deadline)break;
    }
    self.postMessage({type:'done',solved:!!best,pv:best?best.pv:[],plies:best?best.plies:null,depth:finishedDepth,nodes,hits,elapsed:Date.now()-start,reason:'complete',defenderHand:E.handLabel(s.hands[E.ownIndex(-attacker)])});
  }catch(e){
    const reason=e.message==='nodes'?'nodes':e.message==='time'?'time':'error';
    self.postMessage({type:reason==='error'?'error':'done',solved:false,pv:[],plies:null,depth:null,nodes,hits,reason,message:reason==='time'?'時間上限に到達しました':reason==='nodes'?'局面数上限に到達しました':e.message});
  }
};
