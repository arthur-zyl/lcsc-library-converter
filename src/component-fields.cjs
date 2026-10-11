// Keep the small set used by native symbol fields and BOMs; do not copy shop parameters.
function componentFields(part){
 const props=part.properties || {},text=v=>v==null?'':String(v).trim();
 const mpn=text(props['Manufacturer Part']) || text(part.name);
 let value=text(props.Value);
 if(value.startsWith('=')){const key=value.match(/^=\{([^{}]+)\}$/)?.[1];value=key?text(props[key]):'';if(value.startsWith('='))value='';}
 return {value:value || mpn,mpn,manufacturer:text(props.Manufacturer),lcsc:part.id,datasheet:text(props.Datasheet),description:part.description || ''};
}
module.exports={componentFields};
