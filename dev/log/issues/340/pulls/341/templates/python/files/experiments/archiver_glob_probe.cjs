const dir=process.argv[2];const r=require('module').createRequire(dir+'/package.json');
const archiver=r('archiver');const file=require('module').createRequire(r.resolve('archiver'))('archiver-utils').file;
const fs=require('fs'),os=require('os'),p=require('path'),crypto=require('crypto');
const root='/tmp/globprobe';fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root+'/a/b',{recursive:true});
for(const n of ['a/one.txt','a/b/two.txt','a/b/skip.log','.hidden.txt'])fs.writeFileSync(p.join(root,n),n);
console.log(JSON.stringify([file.expand({cwd:root},['**/*.txt','!**/skip*']).sort(),file.expand({cwd:root,dot:true},['**']).sort(),file.expand({cwd:root,filter:'isFile'},['**/*']).sort()]));
const a=archiver('zip');const c=[];a.on('data',x=>c.push(x));a.on('end',()=>console.log(crypto.createHash('sha256').update(Buffer.concat(c)).digest('hex')));
a.glob('**',{cwd:root,dot:true},{date:new Date(0)});a.finalize();
