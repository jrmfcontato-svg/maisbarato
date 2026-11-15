export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ erro: 'Informe a URL do produto.' });

  try {
    let urlFinal = url.trim();
    let html = '';

    // 1. Segue redirecionamentos de links curtos (amzn.to, s.shopee, mercadolivre/sec)
    try {
      const resp = await fetch(urlFinal, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9'
        }
      });
      urlFinal = resp.url || urlFinal;
      html = await resp.text();
    } catch (e) {}

    let loja = 'Amazon';
    if (urlFinal.includes('mercadolivre') || urlFinal.includes('mercadolibre')) loja = 'Mercado Livre';
    else if (urlFinal.includes('shopee')) loja = 'Shopee';
    else if (urlFinal.includes('kabum')) loja = 'KaBuM!';
    else if (urlFinal.includes('magazineluiza') || urlFinal.includes('magalu')) loja = 'Magalu';
    else if (urlFinal.includes('amazon')) loja = 'Amazon';

    const limparTexto = (raw) => {
      if (!raw) return '';
      let t = raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/"/g, '"')
        .replace(/&/g, '&')
        .replace(/'/g, "'")
        .replace(/\s+/g, ' ')
        .replace(/\s*[:|-]\s*(Amazon\.com\.br|Mercado Livre|Shopee Brasil|KaBuM!|Magazine Luiza|Magalu).*$/i, '')
        .replace(/^(Compre|Oferta|Promoção)\s+/i, '')
        .trim();
      if (t.includes('__mobile__') || t.includes('utm_') || t.includes('mmp_pid') || /^\d+\?/.test(t) || t.length < 4) {
        return '';
      }
      return t;
    };

    const melhorarImagem = (imgUrl) => {
      if (!imgUrl) return '';
      let u = imgUrl.replace(/\\u002F/g, '/').trim();
      if (u.startsWith('//')) u = 'https:' + u;
      if (u.includes('mlstatic.com')) u = u.replace(/-[IV]\.(jpg|jpeg|webp|png)/i, '-O.$1');
      if (u.includes('media-amazon.com')) u = u.replace(/\._AC_[A-Z0-9_,]+_\./i, '.');
      return u;
    };

    const imagemValida = (imgUrl) => {
      if (!imgUrl || !imgUrl.startsWith('http')) return false;
      const lixo = ['logo', 'icon', 'sprite', 'favicon', 'shopee-pcmall', 'nav-logo', 'placeholder', 'pixel', 'badge', '1x1'];
      return !lixo.some(b => imgUrl.toLowerCase().includes(b));
    };

    // 2. MERCADO LIVRE (API Oficial: Título, Descrição, Preço, Desconto Real, Ficha e Fotos HD)
    const matchMlb = (urlFinal + ' ' + html).match(/MLB-?(\d{7,12})/i);
    if (loja === 'Mercado Livre' && matchMlb) {
      const idMlb = 'MLB' + matchMlb[1];
      const [mlRes, descRes] = await Promise.all([
        fetch(`https://api.mercadolibre.com/items/${idMlb}`),
        fetch(`https://api.mercadolibre.com/items/${idMlb}/description`).catch(() => null)
      ]);

      if (mlRes.ok) {
        const item = await mlRes.json();
        let descricao = '';
        if (descRes && descRes.ok) {
          const descData = await descRes.json();
          descricao = limparTexto(descData.plain_text || '').slice(0, 320);
        }

        const ficha = {};
        const resumoLista = [];
        if (Array.isArray(item.attributes)) {
          item.attributes.forEach(attr => {
            if (attr.name && attr.value_name && attr.value_name.length < 45) {
              if (Object.keys(ficha).length < 8) ficha[attr.name] = attr.value_name;
              if (['BRAND', 'MODEL', 'CAPACITY', 'PROCESSOR_MODEL', 'RAM_MEMORY', 'SCREEN_SIZE'].includes(attr.id)) {
                resumoLista.push(attr.value_name);
              }
            }
          });
        }

        const listaImagens = Array.isArray(item.pictures)
          ? item.pictures.map(p => melhorarImagem(p.secure_url || p.url)).filter(imagemValida).slice(0, 8)
          : (item.thumbnail ? [melhorarImagem(item.thumbnail)] : []);

        let desconto = 10;
        if (item.original_price && item.price && item.original_price > item.price) {
          desconto = Math.round(((item.original_price - item.price) / item.original_price) * 100);
        }

        return res.status(200).json({
          sucesso: true,
          loja: 'Mercado Livre',
          idExterno: idMlb,
          nome: limparTexto(item.title),
          specsResumo: resumoLista.slice(0, 3).join(' • ') || descricao.slice(0, 90),
          descricao,
          preco: item.price || '',
          precoAntigo: item.original_price || '',
          desconto,
          imagem: listaImagens[0] || '',
          imagens: listaImagens,
          frete: item.shipping?.free_shipping ? 'Frete Grátis' : 'Consultar frete',
          parcelamento: 'Até 12x no cartão',
          ficha
        });
      }
    }

    // 3. EXTRAÇÃO VIA JSON-LD + METADADOS HTML (Amazon, KaBuM!, Magalu)
    let nome = '';
    let descricao = '';
    let preco = null;
    let precoAntigo = null;
    const galeriaSet = new Set();
    const ficha = {};

    const pegarMeta = (prop) => {
      const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
      const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
      return (html.match(r1)?.[1] || html.match(r2)?.[1] || '').trim();
    };

    if (html) {
      // Lê blocos estruturados schema.org/Product
      const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      for (const m of jsonLdMatches) {
        try {
          const parsed = JSON.parse(m[1].trim());
          const itens = Array.isArray(parsed) ? parsed : [parsed];
          for (const obj of itens) {
            if (obj['@type'] === 'Product' || obj.offers) {
              if (obj.name && !nome) nome = limparTexto(obj.name);
              if (obj.description && !descricao) descricao = limparTexto(obj.description).slice(0, 320);
              if (obj.brand?.name) ficha['Marca'] = obj.brand.name;
              if (obj.model) ficha['Modelo'] = obj.model;

              const imgs = Array.isArray(obj.image) ? obj.image : (obj.image ? [obj.image] : []);
              imgs.forEach(i => {
                const u = melhorarImagem(typeof i === 'string' ? i : i?.url);
                if (imagemValida(u)) galeriaSet.add(u);
              });

              const offer = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
              if (offer) {
                const pVal = parseFloat(offer.price || offer.lowPrice);
                if (!isNaN(pVal) && pVal > 0) preco = pVal;
                const pHigh = parseFloat(offer.highPrice);
                if (!isNaN(pHigh) && pHigh > pVal) precoAntigo = pHigh;
              }
            }
          }
        } catch (e) {}
      }

      if (!nome) nome = limparTexto(pegarMeta('og:title') || pegarMeta('twitter:title'));
      if (!descricao) descricao = limparTexto(pegarMeta('og:description') || pegarMeta('description')).slice(0, 320);

      const metaImg = melhorarImagem(pegarMeta('og:image') || pegarMeta('twitter:image'));
      if (imagemValida(metaImg)) galeriaSet.add(metaImg);

      // Captura imagens HD adicionais do HTML (Amazon hiRes, etc.)
      const matchesHiRes = html.matchAll(/"(?:hiRes|large|zoom)"\s*:\s*"(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
      for (const m of matchesHiRes) {
        const u = melhorarImagem(m[1]);
        if (imagemValida(u)) galeriaSet.add(u);
        if (galeriaSet.size >= 8) break;
      }

      if (!preco) {
        const metaPrice = pegarMeta('product:price:amount') || pegarMeta('og:price:amount');
        if (metaPrice) preco = parseFloat(metaPrice);
      }
      if (!preco) {
        const mPrice = html.match(/"priceAmount"\s*:\s*(\d+\.\d{2})/i) ||
                       html.match(/"price"\s*:\s*"?(\d+[.,]\d{2})"?/i) ||
                       html.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/);
        if (mPrice) preco = parseFloat(mPrice[1].replace(/\./g, '').replace(',', '.'));
      }
    }

    // 4. CAMADA ANTI-BLOQUEIO (Jina Reader) para Shopee / Amazon quando o HTML vier bloqueado
    if (!nome || galeriaSet.size === 0 || !preco) {
      try {
        const jinaRes = await fetch(`https://r.jina.ai/${urlFinal}`, {
          headers: { 'Accept': 'text/plain' }
        });
        if (jinaRes.ok) {
          const md = await jinaRes.text();
          if (!nome) {
            const titleLine = md.match(/^Title:\s*(.+)$/m);
            if (titleLine) nome = limparTexto(titleLine[1]);
          }
          if (!preco) {
            const precosMd = [...md.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g)]
              .map(m => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
              .filter(n => n > 5 && n < 100000);
            if (precosMd.length > 0) {
              preco = precosMd[0];
              if (precosMd[1] && precosMd[1] > precosMd[0] && precosMd[1] < precosMd[0] * 2) {
                precoAntigo = precosMd[1];
              }
            }
          }
          const imgsMd = md.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+\.(?:jpg|jpeg|png|webp)[^)\s]*)\)/gi);
          for (const im of imgsMd) {
            const u = melhorarImagem(im[1]);
            if (imagemValida(u)) galeriaSet.add(u);
            if (galeriaSet.size >= 8) break;
          }
        }
      } catch (e) {}
    }

    // Último recurso para título da Shopee: extrai do slug da URL
    if (loja === 'Shopee' && !nome) {
      const slugMatch = urlFinal.match(/shopee\.com\.br\/([^/?#]+)-i\.\d+\.\d+/i);
      if (slugMatch) nome = limparTexto(decodeURIComponent(slugMatch[1]).replace(/-/g, ' '));
    }

    let desconto = 10;
    if (precoAntigo && preco && precoAntigo > preco) {
      desconto = Math.round(((precoAntigo - preco) / precoAntigo) * 100);
    }

    const listaFinal = Array.from(galeriaSet).slice(0, 8);

    return res.status(200).json({
      sucesso: true,
      loja,
      idExterno: matchMlb ? 'MLB' + matchMlb[1] : '',
      nome,
      specsResumo: descricao ? descricao.slice(0, 85) + (descricao.length > 85 ? '...' : '') : '',
      descricao,
      preco: preco || '',
      precoAntigo: precoAntigo || '',
      desconto,
      imagem: listaFinal[0] || '',
      imagens: listaFinal,
      frete: 'Frete Grátis',
      parcelamento: '10x sem juros',
      ficha
    });

  } catch (erro) {
    return res.status(500).json({ erro: 'Falha ao extrair dados: ' + erro.message });
  }
}
