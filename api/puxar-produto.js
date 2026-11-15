export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ erro: 'Informe a URL do produto.' });

  try {
    let urlFinal = url.trim();
    let html = '';

    // 1. Segue redirecionamentos (links curtos amzn.to, mercadolivre.com/sec, s.shopee, etc.)
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

    // Identifica a loja pela URL final
    let loja = 'Amazon';
    if (urlFinal.includes('mercadolivre') || urlFinal.includes('mercadolivre')) loja = 'Mercado Livre';
    else if (urlFinal.includes('shopee')) loja = 'Shopee';
    else if (urlFinal.includes('kabum')) loja = 'KaBuM!';
    else if (urlFinal.includes('magazineluiza') || urlFinal.includes('magalu')) loja = 'Magalu';
    else if (urlFinal.includes('amazon')) loja = 'Amazon';

    // 2. Caso seja Mercado Livre, usa a API oficial para pegar 100% dos dados exatos
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
        return res.status(200).json({
          sucesso: true,
          loja: 'Mercado Livre',
          idExterno: idMlb,
          nome: item.title || '',
          preco: item.price || '',
          imagem: (item.pictures && item.pictures[0]?.secure_url) || item.thumbnail || '',
          frete: item.shipping?.free_shipping ? 'Frete Grátis' : 'Consultar frete',
          parcelamento: 'Até 12x no cartão',
          ficha
        });
      }
    }

    // 3. Extração via Metadados HTML (OpenGraph / JSON-LD)
    const pegarMeta = (prop) => {
      const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
      const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
      return (html.match(r1)?.[1] || html.match(r2)?.[1] || '').trim();
    };

    let nome = pegarMeta('og:title') || pegarMeta('twitter:title');
    let imagem = pegarMeta('og:image') || pegarMeta('twitter:image');
    let precoRaw = pegarMeta('product:price:amount') || pegarMeta('og:price:amount');

    // Tenta buscar preço no JSON-LD embutido na página (muito comum em KaBuM, Magalu e Amazon)
    if (!precoRaw && html) {
      const matchJsonPrice = html.match(/"price"\s*:\s*"?(\d+[.,]\d{2})"?/i) ||
                             html.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/);
      if (matchJsonPrice) {
        precoRaw = matchJsonPrice[1].replace(/\./g, '').replace(',', '.');
      }
    }

    // 4. Fallback gratuito via Microlink API se a loja bloqueou a leitura direta (ex: Amazon/Shopee)
    if (!nome || !imagem) {
      const microRes = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(urlFinal)}`);
      if (microRes.ok) {
        const micro = await microRes.json();
        if (micro.data) {
          nome = nome || micro.data.title || '';
          imagem = imagem || micro.data.image?.url || '';
        }
      }
    }

    // Limpa sufixos padrão do título (ex: ": Amazon.com.br: Computadores e Informática")
    nome = nome
      .replace(/\s*[:|-]\s*(Amazon\.com\.br|Mercado Livre|Shopee Brasil|KaBuM!|Magazine Luiza).*$/i, '')
      .replace(/"/g, '"')
      .replace(/&/g, '&')
      .trim();

    return res.status(200).json({
      sucesso: true,
      loja,
      idExterno: matchMlb ? 'MLB' + matchMlb[1] : '',
      nome,
      preco: precoRaw ? parseFloat(precoRaw) : '',
      imagem,
      frete: 'Frete Grátis',
      parcelamento: '10x sem juros',
      ficha: {}
    });

  } catch (erro) {
    return res.status(500).json({ erro: 'Não foi possível extrair os dados automaticamente: ' + erro.message });
  }
}
