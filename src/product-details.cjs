function parseDetails(html, id, url) {
  let record = {}, structured = {}, web = {};
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    try {
      if (/\bid=["']__NEXT_DATA__["']/i.test(match[1])) {
        const data = JSON.parse(match[2]).props?.pageProps?.webData;
        if (data?.productRecord?.productCode === id) { record = data.productRecord; web = data; }
      } else if (/application\/ld\+json/i.test(match[1])) {
        const value = JSON.parse(match[2]);
        const product = (Array.isArray(value) ? value : value['@graph'] || [value]).find(x => x['@type'] === 'Product' && x.sku === id);
        if (product) structured = product;
      }
    } catch {}
  }
  if (!record.productCode && !structured.sku) throw new Error('商品详情未返回匹配的 C 编号');
  const image = Array.isArray(structured.image) ? structured.image[0] : structured.image;
  return { id, url, name: record.productModel || structured.mpn || structured.name || id,
    image: record.breviaryImageUrl || image || '', brand: record.productGradePlateName || record.brandName || structured.brand?.name || '',
    package: [record.encapsulationModel, record.standard].find(x => x && x !== '-') || '',
    summary: [record.productType, record.productName, record.productArrange].filter(Boolean).join(' / '),
    description: record.remark || record.productIntro || structured.description || '',
    category: record.productType || structured.category || '', packaging: record.productArrange || '',
    stock: Number(web.totalStockNumber ?? record.stockNumber ?? record.validStockNumber ?? NaN), label: record.smtLabel || '',
    parameters: (web.paramList || []).map(p => ({ name: p.parameterName, value: p.parameterDetailValue || p.parameterValue })).filter(p => p.name && p.value),
    packSize: record.productMinEncapsulationNumber ? `${record.productMinEncapsulationNumber}${record.productUnit || '个'}/${record.productMinEncapsulationUnit || '包装'}` : '' };
}
module.exports = { parseDetails };
