const fs = require('fs');

async function atualizarCatalogo() {
  const raw = fs.readFileSync('produtos.json', 'utf8');
  const dados = JSON.parse(raw);
  const produtos = dados.produtos || dados;

  for (const prod of produtos) {
    const menorAntes = Math.min(...prod.ofertas.map(o => o.preco));

    for (const oferta of prod.ofertas) {
      // Atualização automática via API Oficial do Mercado Livre
      if (oferta.loja === 'Mercado Livre' && oferta.idExterno) {
        try {
          const res = await fetch(`https://api.mercadolibre.com/items/${oferta.idExterno}`);
          const item = await res.json();
          if (item && item.price) {
            oferta.preco = Number(item.price);
            console.log(`[ML] ${prod.nome} -> R$ ${oferta.preco}`);
          }
        } catch (err) {
          console.error(`Erro ML (${oferta.idExterno}):`, err.message);
        }
      }
    }

    // Recalcula menor preço e percentual de queda
    const menorDepois = Math.min(...prod.ofertas.map(o => o.preco));
    if (menorDepois < menorAntes) {
      prod.quedaPercentual = Math.round(((menorAntes - menorDepois) / menorAntes) * 100);
    }

    // Atualiza o último ponto do gráfico de histórico
    if (Array.isArray(prod.historico) && prod.historico.length > 0) {
      prod.historico[prod.historico.length - 1] = menorDepois;
    }
  }

  // Atualiza data/hora no topo do site (Fuso Horário de Brasília)
  const dataBR = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short'
  });

  const saida = {
    ultimaAtualizacao: dataBR,
    produtos: produtos
  };

  fs.writeFileSync('produtos.json', JSON.stringify(saida, null, 2));
  console.log('Catálogo atualizado com sucesso em:', dataBR);
}

atualizarCatalogo();