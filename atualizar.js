export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ erro: 'Informe a URL do produto.' });

  try {
    let urlFinal = url.trim();
    let html = '';

    try {
      const resp = await fetch(urlFinal, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9'
        }
      });
      urlFinal = resp.url || urlFinal;
      html = await resp.text();
    } catch (e) {}

    let loja = 'Amazon';
    if (urlFinal.includes('mercadolivre')) loja = 'Mercado Livre';
    else if (urlFinal.includes('shopee')) loja = 'Shopee';
    else if (urlFinal.includes('kabum')) loja = 'KaBuM!';
    else if (urlFinal.includes('magazineluiza') || urlFinal.includes('magalu')) loja = 'Magalu';
    else if (urlFinal.includes('amazon')) loja = 'Amazon';

    // 1. Mercado Livre: extrai todas as fotos do carrossel via API oficial
    const matchMlb = (urlFinal + ' ' + html).match(/MLB-?(\d{7,12})/i);
    if (loja === 'Mercado Livre' && matchMlb) {
      const idMlb = 'MLB' + matchMlb[1];
      const mlRes = await fetch(`https://api.mercadolibre.com/items/${idMlb}`);
      if (mlRes.ok) {
        const item = await mlRes.json();
        const ficha = {};
        if (Array.isArray(item.attributes)) {
          item.attributes.slice(0, 6).forEach(attr => {
            if (attr.name && attr.value_name) ficha[attr.name] = attr.value_name;
          });
        }
        const listaImagens = Array.isArray(item.pictures)
          ? item.pictures.map(p => p.secure_url || p.url).filter(Boolean).slice(0, 8)
          : (item.thumbnail ? [item.thumbnail] : []);

        return res.status(200).json({
          sucesso: true,
          loja: 'Mercado Livre',
          idExterno: idMlb,
          nome: item.title || '',
          preco: item.price || '',
          imagem: listaImagens[0] || '',
          imagens: listaImagens,
          frete: item.shipping?.free_shipping ? 'Frete Grátis' : 'Consultar frete',
          parcelamento: 'Até 12x no cartão',
          ficha
        });
      }
    }

    // 2. Outras lojas: extrai og:image + imagens do JSON-LD e atributos de galeria
    const pegarMeta = (prop) => {
      const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
      const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
      return (html.match(r1)?.[1] || html.match(r2)?.[1] || '').trim();
    };

    let nome = pegarMeta('og:title') || pegarMeta('twitter:title');
    let imagemPrincipal = pegarMeta('og:image') || pegarMeta('twitter:image');
    let precoRaw = pegarMeta('product:price:amount') || pegarMeta('og:price:amount');

    const galeriaSet = new Set();
    if (imagemPrincipal) galeriaSet.add(imagemPrincipal);

    if (html) {
      // Captura imagens em blocos JSON-LD ("image": [...] ou "hiRes":"...")
      const matchesHiRes = html.matchAll(/"(?:hiRes|large|secure_url)"\s*:\s*"(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
      for (const m of matchesHiRes) {
        galeriaSet.add(m[1].replace(/\\u002F/g, '/'));
        if (galeriaSet.size >= 8) break;
      }

      if (!precoRaw) {
        const matchJsonPrice = html.match(/"price"\s*:\s*"?(\d+[.,]\d{2})"?/i) ||
                               html.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/);
        if (matchJsonPrice) {
          precoRaw = matchJsonPrice[1].replace(/\./g, '').replace(',', '.');
        }
      }
    }

    if (!nome || galeriaSet.size === 0) {
      const microRes = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(urlFinal)}`);
      if (microRes.ok) {
        const micro = await microRes.json();
        if (micro.data) {
          nome = nome || micro.data.title || '';
          if (micro.data.image?.url) galeriaSet.add(micro.data.image.url);
        }
      }
    }

    nome = nome
      .replace(/\s*[:|-]\s*(Amazon\.com\.br|Mercado Livre|Shopee Brasil|KaBuM!|Magazine Luiza).*$/i, '')
      .replace(/"/g, '"')
      .replace(/&/g, '&')
      .trim();

    const listaFinal = Array.from(galeriaSet).slice(0, 8);

    return res.status(200).json({
      sucesso: true,
      loja,
      idExterno: matchMlb ? 'MLB' + matchMlb[1] : '',
      nome,
      preco: precoRaw ? parseFloat(precoRaw) : '',
      imagem: listaFinal[0] || '',
      imagens: listaFinal,
      frete: 'Frete Grátis',
      parcelamento: '10x sem juros',
      ficha: {}
    });

  } catch (erro) {
    return res.status(500).json({ erro: 'Não foi possível extrair os dados: ' + erro.message });
  }
}
