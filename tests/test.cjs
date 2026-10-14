const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../engine.js');
const S='8k/6G2/7G1/9/9/9/9/9/9 b R 1';
function solver(sfen,defenderAll=true,depth=7){
 const ctx=vm.createContext({console,Date,Set,Map,Int8Array,Uint8Array,Int16Array,Array,Math,Number,Error,String});
 ctx.self=ctx;ctx.importScripts=name=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../solver-worker.js'),'utf8'),ctx);
 let finished;
 ctx.postMessage=x=>{if(x.type==='done'||x.type==='error')finished=x;};
 ctx.onmessage({data:{type:'solve',sfen,defenderAll,depth,seconds:10,maxNodes:2000000}});
 return finished;
}
test('SFEN parsing and kings',()=>{let p=E.parseSfen(S);assert.equal(p.board[8],-8);assert.equal(p.kings[1],8);assert.equal(p.turn,1);assert.equal(p.hands[0][7],1);assert.equal(p.source,S);});
test('SFEN rejects invalid formats and ambiguous extra moves',()=>{assert.throws(()=>E.parseSfen('abc'));assert.throws(()=>E.parseSfen(S+' moves 7g7f'),/未対応/);assert.throws(()=>E.parseSfen('8k/6G2/7G1/9/9/9/9/9/8k b R 1'),/複数/);});
test('remaining-piece defender hand fills automatically',()=>{let p=E.fillDefenderHand(E.parseSfen(S));assert.equal(p.hands[1][1],18);assert.equal(p.hands[1][5],2);assert.equal(p.hands[1][7],1);});
test('rook can mate in one despite unlimited defender hand',()=>{let p=solver(S,true,1);assert.equal(p.type,'done');assert.equal(p.solved,true);assert.equal(p.plies,1);assert.equal(p.pv.length,1);assert.equal(p.pv[0].piece,7);});
test('pawn-drop mate is illegal',()=>{const s='8k/6G2/7G1/9/9/9/9/9/9 b P 1';let p=E.parseSfen(s);let pawnDrop=E.generateChecks(p,1).find(m=>E.usiMove(m)==='P*1b');assert.ok(pawnDrop);assert.equal(E.isPawnDropMate(p,pawnDrop,1),true);let result=solver(s,true,1);assert.equal(result.solved,true);assert.notEqual(E.usiMove(result.pv[0]),'P*1b');});
test('pawn direction and knight directions correct for both sides',()=>{
  let p=E.parseSfen('4k4/4P4/9/9/9/9/9/9/9 b - 1');
  assert.equal(E.isAttacked(p,p.kings[1],1),true);
  p=E.parseSfen('9/9/9/9/9/9/9/4p4/4K4 w - 1');
  assert.equal(E.isAttacked(p,p.kings[0],-1),true);
});
test('apply and undo are reversible on captures and drops',()=>{
 const p=E.parseSfen('4k4/9/4p4/4R4/9/9/9/9/9 b G 1');
 let before=JSON.stringify([...p.board])+JSON.stringify(p.hands.map(x=>[...x]));
 for(const m of E.generateChecks(p,1)) {
  let u=E.makeMove(p,m,1);E.undoMove(p,m,1,u);
  assert.equal(JSON.stringify([...p.board])+JSON.stringify(p.hands.map(x=>[...x])),before);
 }
});
test('longer source position: principal variation always checks',()=>{
 const s='9/9/3pp4/+r2k1p3/2L1+p4/2+R6/B8/B8/9 b 4g4s4n3l14p 1';
 const r=solver(s,true,9);
 assert.equal(r.solved,true);assert.equal(r.plies%2,1);
 const p=E.fillDefenderHand(E.parseSfen(s));let turn=p.turn;
 for(let i=0;i<r.pv.length;i++){
  const m=r.pv[i];assert.ok((turn===p.turn?E.generateChecks(p,turn):E.generateDefenses(p,turn)).some(x=>E.usiMove(x)===E.usiMove(m)));
  E.makeMove(p,m,turn);turn=-turn;
 }
 assert.equal(E.generateDefenses(p,turn).length,0);
});
