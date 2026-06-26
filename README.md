# Jogo da Velha WebSocket

Projeto minimalista de jogo da velha em tempo real com uma sala unica.

## Link publico

[jogo-da-velha.adoroautomacao.com.br](https://jogo-da-velha.adoroautomacao.com.br/)

## Precisamos de framework?

Nao. Para manter tudo enxuto, este projeto usa:

- Node.js nativo para servir os arquivos
- WebSocket implementado no proprio servidor
- HTML, CSS e JavaScript puros no cliente

Sem React, sem Express e sem bibliotecas externas.

## Como rodar

```bash
npm start
```

Depois abra:

```text
http://localhost:3000
```

Para desenvolvimento com reload do servidor:

```bash
npm run dev
```

## Como jogar

1. Abra o app no navegador.
2. Compartilhe o link com outra pessoa.
3. O primeiro cliente vira `X`, o segundo vira `O`.
4. Clientes extras entram como espectadores.

## Estrutura

```text
jogo-da-velha-websocket/
|-- package.json
|-- server.js
`-- public/
    |-- index.html
    |-- styles.css
    `-- app.js
```

## Observacoes

- Se um jogador sair, a sala e reiniciada.
- Qualquer jogador pode iniciar uma nova rodada.
- Existe apenas uma partida global por vez.
