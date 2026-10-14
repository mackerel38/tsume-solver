'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
function run(depth,sfen='8k/6G2/7G1/9/9/9/9/9/9 b R 1',synthetic=false){
 const ctx=vm.createContext({console,Date,Set,Map,Int8Array,Uint8Array,Int16Array,Array,Math,Number,Error,String});
 ctx.self=ctx;
 ctx.importScripts=name=>{
  vm.runInContext(fs.readFileSync(path.join(ROOT,name),'utf8'),ctx,{filename:name});
  if(synthetic){
   const E=ctx.Shogi;
   E.parseSfen=()=>{
    const board=new Int8Array(81);board[0]=7;board[40]=-7;board[80]=-8;
    return {board,hands:[new Uint8Array(9),new Uint8Array(9)],kings:new Int8Array([-1,80]),turn:1};
   };
   E.generateChecks=s=>{
    const a=s.board.indexOf(7);return [{from:a,to:(a+1)%40,piece:7,promote:false}];
   };
   E.generateDefenses=s=>{
    const a=s.board.indexOf(7),b=s.board.indexOf(-7)-40;
    const cycle=(b-a+1+40)%40;
    const numAttacks=cycle*40+a+(a===0?40:0);
    if(numAttacks>=1001)return [];
    return [{from:b+40,to:40+((b+(a===0?2:1))%40),piece:7,promote:false}];
   };
  }
 };
 vm.runInContext(fs.readFileSync(path.join(ROOT,'dfpn-worker.js'),'utf8'),ctx,{filename:'dfpn-worker.js'});
 let result;
 ctx.postMessage=msg=>{if(msg.type==='done'||msg.type==='error')result=msg;};
 ctx.onmessage({data:{type:'solve',depth,sfen,defenderAll:!synthetic,seconds:20,maxNodes:100000}});
 return result;
}
test('2001-ply limit is not clamped to 999',()=>{
 const r=run(2001);
 assert.equal(r.type,'done',r.message);assert.equal(r.depth,2001);assert.equal(r.plies,1);
});
test('unlimited depth has no numerical horizon',()=>{
 const r=run(0);
 assert.equal(r.type,'done',r.message);assert.equal(r.unlimited,true);assert.equal(r.depth,null);assert.equal(r.plies,1);
});
test('explicit search and reconstruction stacks support an actual 2001-ply forced line',()=>{
 const r=run(2001,'unused',true);
 assert.equal(r.type,'done',r.message);assert.equal(r.solved,true,r.message);
 assert.equal(r.plies,2001);assert.equal(r.pv.length,2001);
 assert.equal(r.depth,2001);
});
test('unlimited mode reconstructs an actual 2001-ply forced line',()=>{
 const r=run(0,'unused',true);
 assert.equal(r.type,'done',r.message);assert.equal(r.solved,true,r.message);
 assert.equal(r.plies,2001);assert.equal(r.pv.length,2001);
 assert.equal(r.unlimited,true);
});

test('10001-ply setting is accepted without an internal cap',()=>{
 const r=run(10001);
 assert.equal(r.type,'done',r.message);assert.equal(r.depth,10001);assert.equal(r.plies,1);
});
test('unlimited no-check position is not incorrectly reported as mate',()=>{
 const r=run(0,'8k/9/9/9/9/9/9/9/9 b - 1');
 assert.equal(r.type,'done',r.message);assert.equal(r.solved,false);
 assert.equal(r.reason,'disproof');
});
