const fs=require('fs'),vm=require('vm'),path=require('path');
const messages=[];
const context=vm.createContext({console,Date,Set,Map,Int8Array,Uint8Array,Int16Array,Array,Math,Number,Error,String,parseInt});
context.self=context;
context.importScripts=(name)=>vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..',name),'utf8'),context,{filename:name});
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../solver-worker.js'),'utf8'),context,{filename:'worker.js'});
context.postMessage=msg=>{messages.push(msg); if(msg.type==='progress')console.log('progress',msg.depth,msg.nodes,msg.elapsed+'ms');else console.log(msg.type,msg.plies,JSON.stringify(msg.pv),msg.message);};
context.onmessage({data:{type:'solve',sfen:process.argv[2]||'9/9/3pp4/+r2k1p3/2L1+p4/2+R6/B8/B8/9 b 4g4s4n3l14p 1',defenderAll:process.argv[3]!=='no',seconds:10,maxNodes:500000,depth:11}});
