const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
function validTemp(root){return typeof root==='string' && path.dirname(path.resolve(root))===path.resolve(os.tmpdir()) && path.basename(root).startsWith('eda-hub-export-');}
async function preserveArtifacts(root,archiveRoot,detail){
 if(!validTemp(root))throw new Error('临时目录校验失败，未归档。');
 const source=path.resolve(root),base=path.resolve(archiveRoot);
 if(base===source || base.startsWith(source+path.sep))throw new Error('诊断目录不能位于本次临时目录内。');
 if(!(await fs.stat(source).catch(()=>null)))return '';
 await fs.writeFile(path.join(source,'failure.json'),JSON.stringify({savedAt:new Date().toISOString(),...detail},null,2));
 await fs.mkdir(base,{recursive:true});
 const container=await fs.mkdtemp(path.join(base,path.basename(source)+'-'));
 const destination=path.join(container,'files');
 // Delete the source only after every input and processing log is copied.
 await fs.cp(source,destination,{recursive:true,force:false,errorOnExist:true});
 await fs.rm(source,{recursive:true,force:true});return destination;
}
function hasFailure(job,result,error){return !!error || result?.results?.some(r=>r.status==='failed') || (!job.stopRequested && (result?.failed || 0)>0);}
module.exports={preserveArtifacts,validTemp,hasFailure};
