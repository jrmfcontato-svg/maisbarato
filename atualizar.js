const fs = require('fs');

async function atualizarPrecos() {
  const raw = fs.readFileSync('produtos.json', 'utf8');
  const dados = JSON.parse(raw);
  const lista = dados.produtos || dados;

  for (const prod of lista) {
    for (const oferta of prod.ofertas) {
      if (oferta.loja === 'Mercado Livre' && oferta.idExterno) {
        try {
          const res = await fetch(`https://api.mercadolibre.com/items/${oferta.idExterno}`);
          if (res.ok) {
            const item = await res.json();
            if (item.price) {
              oferta.preco = item.price;
            }
          }
        } catch (err) {
          console.log(`Erro ao consultar ${oferta.idExterno}:`, err.message);
        }
      }
    }

    const menorAtual = Math.min(...prod.ofertas.map(o => o.preco));
    if (Array.isArray(prod.historico) && prod.historico.length > 0) {
      prod.historico[prod.historico.length - 1] = menorAtual;
    }
  }

  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short'
  });

  const saida = {
    ultimaAtualizacao: agora,
    config: dados.config || {},
    produtos: lista
  };

  fs.writeFileSync('produtos.json', JSON.stringify(saida, null, 2), 'utf8');
  console.log('Preços e configurações atualizados em:', agora);
}

atualizarPrecos();
