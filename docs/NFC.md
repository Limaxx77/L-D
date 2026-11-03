# Cartões NFC e QR Codes das mesas

Cada mesa tem um link exclusivo, por exemplo `https://pastelld.com.br/mesa/K0puOqQf5ZUXL73s`. O final é um código aleatório: trocar o número na URL **não** abre outra mesa. O QR Code e o cartão NFC da mesma mesa abrem o mesmo link.

> Defina o domínio definitivo (`PUBLIC_APP_URL`) antes de gravar os cartões.

## Material

- Tags/cartões **NTAG213** (suficiente), NTAG215 ou NTAG216.
- Um celular Android com NFC (iPhone também grava pelo app NFC Tools).

## Opção 1 — gravar direto pelo painel (Chrome no Android)

1. Abra `/admin` → **NFC e QR Codes** no Chrome do Android.
2. Toque em **Gravar NFC** na mesa desejada e aproxime o cartão até a confirmação.

## Opção 2 — app NFC Tools (Android ou iPhone)

1. No painel, toque em **Copiar link** da mesa.
2. No NFC Tools: **Escrever → Adicionar um registro → URL/URI** → cole o link.
3. **Escrever** e aproxime o cartão.
4. Teste: aproxime um celular desbloqueado — o cardápio da mesa deve abrir.
5. Recomendado: **Outros → Bloquear tag**, para ninguém regravar o cartão. Atenção: o bloqueio é permanente — se gerar um novo link, será preciso um cartão novo.

## QR Code

- **PNG** (1024 px) ou **SVG** (vetor, ideal para gráfica) em cada mesa.
- **Imprimir** gera um cartão de mesa com o nome, o QR e as instruções.

## Gerar novo link

Use **Novo link** se um cartão/QR for copiado ou levado. O link antigo para de funcionar na hora; regrave o NFC e reimprima o QR.

## Como funciona na mesa

1. O cliente aproxima o celular ou lê o QR e informa o nome.
2. A primeira pessoa abre a comanda automaticamente (pode ser desativado em Configurações → Mesas).
3. Outras pessoas entram pelo mesmo cartão; quem não tem celular pode ser adicionado por outra pessoa.
4. Pedidos chegam ao painel; o atendente confirma (configurável) e a cozinha prepara.
5. Na aba **Conta**, a mesa escolhe a divisão e toca em **Solicitar fechamento**; o painel avisa o atendente.
6. O atendente registra cada pagamento (parcial ou total) e fecha a mesa, que volta a **Livre**. A próxima abertura cria uma nova comanda, sem misturar pedidos.
