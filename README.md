# Painel de Finanças

Painel financeiro pessoal/familiar em **Electron (Node.js)** — roda como app desktop e pode ser
empacotado como um `.exe` instalável para Windows.

## O que tem

- Cartões de KPI: Receita, Despesas, Lucro, Fluxo de caixa do período, Saldo de caixa atual
- Tendência mensal (receita x despesas x saldo acumulado)
- Divisão de despesas por categoria (rosca + legenda)
- Orçado vs. realizado por categoria
- Tabela de transações recentes com busca
- Filtros por pessoa, período (mês/ano) e categoria
- Suporte para **múltiplas pessoas** (ex: você e seu parceiro(a)), cada uma com seu próprio saldo inicial
- Dados salvos localmente em um arquivo JSON (nada vai para a internet)

## Aba "Contas a pagar"

Além da Visão geral, o app tem uma segunda aba (barra lateral) com um controle de contas a pagar:

- Colunas: **Conta**, **Vencimento**, **Período** (calculado automaticamente a partir do
  vencimento), **Valor de Referência**, **Forma de Pagamento**, **Banco**, **Pessoa**, **Valor
  Pago** (a baixa — preencha quando pagar) e **Comprovante** (cole o link do Google Drive).
- Filtro de período na barra lateral: mês atual por padrão, com setas para
  mês anterior/seguinte ou "Todos os períodos" para ver tudo.
- Linha fica **verde** quando paga, **amarela** quando falta até 2 dias para o vencimento, e
  **vermelha** quando atrasada sem pagamento.
- Pessoa é opcional por conta; o tipo (PF/PJ) e CPF/CNPJ de cada pessoa ficam cadastrados em
  "+ gerenciar pessoas" na barra lateral.

### Importar uma planilha de contas

Clique em "Importar planilha" na aba Contas a pagar e escolha um arquivo `.xlsx`, `.xls` ou
`.csv` com estas colunas no cabeçalho (nomes flexíveis — maiúsculas/minúsculas e acentos não
importam):

| Conta | Vencimento | Valor de Referência | Forma de Pagamento | Banco |
|---|---|---|---|---|
| Aluguel | 05/10/2026 | 1500,00 | Transferência | Itaú |

O **Período** não é uma coluna da planilha — é calculado automaticamente a partir do
Vencimento. Linhas sem "Conta" ou "Vencimento" válidos são ignoradas na importação (o app avisa
quantas linhas entraram). Depois de importar, associe pessoa, dê baixa e cole o comprovante
diretamente na tabela.

## Requisitos

- [Node.js](https://nodejs.org) 18 ou superior instalado

## Como rodar em modo de desenvolvimento

```bash
cd finance-dashboard
npm install
npm start
```

Isso abre a janela do app. Na primeira execução, os **dados de exemplo** (`data/sample-data.json`)
são copiados para a pasta de dados do usuário do Windows/Mac/Linux — editar esse arquivo de
exemplo não afeta o app depois da primeira vez; use os botões "Importar/Exportar JSON" na
barra lateral para trocar seus dados a qualquer momento.

## Como substituir pelos seus próprios dados

Duas formas:

1. **Pela interface**: use o botão "+ Nova transação" para cadastrar receitas/despesas uma a uma,
   e "+ gerenciar pessoas" para adicionar/remover pessoas. Tudo é salvo automaticamente.
2. **Importando um JSON**: edite um arquivo seguindo a mesma estrutura de `data/sample-data.json`
   (pessoas, categorias, orçamentos, transações, saldo inicial de caixa) e clique em
   "Importar JSON" na barra lateral. Use "Exportar JSON" para fazer backup dos seus dados atuais.

Estrutura resumida do JSON:

```jsonc
{
  "people": [{ "id": "p1", "name": "Você", "color": "#3fbf8f" }],
  "categories": { "income": ["Salário", "..."], "expense": ["Moradia", "..."] },
  "budgets": [{ "personId": "p1", "month": "2026-09", "category": "Moradia", "budgeted": 1500 }],
  "transactions": [
    { "id": "t1", "personId": "p1", "date": "2026-09-05", "type": "income", "category": "Salário", "description": "Salário mensal", "amount": 6500 }
  ],
  "startingCashBalance": { "p1": 3200 }
}
```

## Erro "SUID sandbox helper binary" ao rodar no Linux

Se `npm start` falhar com `FATAL:setuid_sandbox_host.cc ... SUID sandbox helper binary`,
é porque o Electron precisa de um binário com permissão especial (`chrome-sandbox`) para isolar
o processo. Isso costuma falhar quando o projeto está numa pasta de mídia removível/externa
(ex: `/run/media/...`), que no Linux geralmente é montada com a opção `nosuid` — nesse caso
nem `sudo chown root` + `chmod 4755` resolve, porque o próprio ponto de montagem ignora o bit
suid.

O script `npm start` já está configurado para rodar com `--no-sandbox`, o que evita o problema
(o isolamento extra do Chromium não é essencial para uso local/pessoal). Se quiser manter o
sandbox ativo, mova o projeto para uma pasta dentro do seu disco principal (ex: `~/Projetos/`)
e rode `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox` antes de `npm start`.

## Como gerar o instalador `.exe`

```bash
npm install
npm run dist
```

O instalador NSIS (`.exe`) é gerado em `dist/`. Ele funciona tanto rodando no Windows quanto
via `electron-builder` com suporte cross-build a partir de Linux/Mac (requer Wine instalado
para builds cross-platform; rodar `npm run dist` diretamente no Windows é o caminho mais simples).

Se preferir apenas testar a pasta empacotada sem gerar o instalador:

```bash
npm run dist:dir
```

## Onde ficam os dados

O app grava um arquivo `dados-financas.json` na pasta de dados do usuário do sistema
operacional (ex: `%APPDATA%\Painel de Finanças` no Windows). O caminho exato aparece no
rodapé da barra lateral do app. Isso significa que seus dados **persistem entre atualizações
do app** e não são sobrescritos ao gerar um novo `.exe`.

## Estrutura do projeto

```
finance-dashboard/
  main.js            # processo principal do Electron (janela + leitura/escrita de dados)
  preload.js          # ponte segura entre o app e o processo principal
  package.json        # dependências e script de build do .exe
  data/
    sample-data.json  # dados de exemplo iniciais
  renderer/
    index.html         # layout do painel
    styles.css          # tema visual
    app.js               # filtros, gráficos (Chart.js) e CRUD de transações/pessoas
```
