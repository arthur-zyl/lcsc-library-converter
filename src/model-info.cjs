// Persist this flag with final libraries: temporary source archives are deleted.
function modelInfo(manifest={}){
  const explicit=manifest.modelSource;
  const placeholder=explicit?.kind==='height_placeholder' || (!explicit && (manifest.warnings||[]).some(w=>w.includes('未绑定独立 3D 模型') && w.includes('高度')));
  const model=manifest.placement?.model3D || manifest.device?.model3D;
  return {kind:placeholder?'height_placeholder':'real',placeholder,sourceModelUuid:model?.uuid || '',sourceModelName:model?.name || '',updatedAt:new Date().toISOString()};
}
module.exports={modelInfo};
