# Futures Intelligence Dashboard

个人使用的期货研究平台。现包含 Position Structure 与半自动 CTA 决策引擎 Beta：规则校验、机器状态、风险提示和人工决策记录；不提供自动下单能力。

## Tech Stack

- Frontend: Next.js, React, TypeScript, TailwindCSS, shadcn/ui style components, Recharts
- Backend: Python, FastAPI
- Database: PostgreSQL
- ORM: SQLAlchemy

## Project Structure

```text
.
├── apps
│   ├── api              # FastAPI + SQLAlchemy
│   └── web              # Next.js dashboard
├── data                 # CSV mock data
├── scripts              # Local utility scripts
└── docker-compose.yml   # PostgreSQL
```

## Data Model

## Mock Symbols

- 黑色工业：`RB` 螺纹钢, `HC` 热轧卷板, `I` 铁矿石, `J` 焦炭, `JM` 焦煤, `SF` 硅铁, `SM` 锰硅
- 有色：`CU` 沪铜, `AL` 沪铝, `ZN` 沪锌, `PB` 沪铅, `NI` 沪镍, `SN` 沪锡, `AO` 氧化铝
- 农产品：`A` 豆一, `M` 豆粕, `C` 玉米, `CS` 玉米淀粉, `JD` 鸡蛋, `CF` 棉花, `SR` 白糖, `AP` 苹果, `PK` 花生
- 油脂：`Y` 豆油, `P` 棕榈油, `OI` 菜籽油, `RM` 菜籽粕
- 贵金属：`AU` 黄金, `AG` 白银

Raw table: `raw_positions`

- `date`
- `symbol`
- `broker`
- `long_position`
- `long_change`
- `short_position`
- `short_change`
- `rank`

Feature table: `position_features`

- `net_position`
- `net_change`
- `long_ratio`
- `short_ratio`
- `top5_concentration`
- `top10_concentration`
- `consecutive_long_add_days`
- `consecutive_long_reduce_days`
- `consecutive_short_add_days`
- `consecutive_short_reduce_days`

Feature 数据可以每天重新计算，Beta 版采用全量重建，后续可替换为按交易日增量计算。

## API

- `GET /symbols`
- `GET /dates?symbol=RB`
- `GET /overview?symbol=RB&date=2026-09-04`
- `GET /leaderboard?symbol=RB&date=2026-09-04`
- `GET /trend?symbol=RB&date=2026-09-04`
- `GET /strength?symbol=RB&date=2026-09-04`
- `GET /summary?symbol=RB&date=2026-09-04`
- `GET /market/live?timeframe=5m` - TqSdk 行情快照（支持 `1m/5m/15m/30m/1h/1d`）
- `GET /market/trends` - 最近 3 根已收盘日 K 的价格、成交量与持仓量趋势筛选
- `GET /market/trends/backtest/symbols` - 趋势规则可验证品种
- `GET /market/trends/backtest/dates?variety=P` - 品种可回放交易日
- `GET /market/trends/backtest?variety=P&as_of=2026-08-18` - 单日历史信号与后续表现
- `GET /market/trends/backtest/summary?variety=P` - 价格结构与量仓确认的历史对照统计

`/live-market` 使用 quote 展示实时价格，并在表格内展示所选全局周期最近 5 个期货交易日的价格折线，以及最近 7 根 K 线的 OI 变化轨迹。20:00 后的夜盘归入下一工作日。行情快照以 JSON 原子写入 `data/live_market`（可用 `MARKET_SNAPSHOT_DIR` 覆盖）；休市、收盘或 TqSdk 暂时不可用时 API 继续返回最后一次静态快照。

`/trend-tracker` 动态读取国内各商品品种的当前主力真实合约，排除金融期货与化工品种，并显式保留天然橡胶 `RU`、20号胶 `NR`、合成橡胶 `BR`。全市场日线由独立 worker 维护，不影响实时自选行情。趋势分为 100 分：价格结构 60 分、成交量条件 20 分、持仓量条件 20 分。历史验证使用 `KQ.m@` 主连连续日线，在所选日只读取当日及之前数据，随后比较 1/3/5 交易日表现与“仅价格结构”基准；结果仅用于研究，不构成开仓建议。

### CTA Beta API

- `GET /cta/contracts`
- `PUT /cta/contracts/{contract}`
- `POST /cta/bars`
- `POST /cta/evaluate?contract=P2701`
- `GET /cta/backtest/dates?contract=P2701`
- `GET /cta/backtest?contract=P2701&as_of=2026-08-20`
- `GET /cta/reports/latest?contract=P2701`
- `POST /cta/reports/{report_id}/human-decisions`

CTA Beta 当前只使用两个因子：日线趋势（MA5/MA20）与席位净持仓变化（最近两个交易日）。1H、30min、OI、风险收益比和复杂风险评分暂不参与判断。`READY` 只表示这两个条件同向，不构成交易指令。

CTA 的历史信号回放会固定在所选交易日：趋势和持仓评分只读取该日及之前的数据，随后分别计算 1、3、5 个交易日的收盘表现。它用于检验规则在历史时点的表现，不包含手续费、滑点、仓位管理或移仓收益。

## Quick Start

1. Start PostgreSQL:

```bash
docker compose up -d
```

2. Prepare the API:

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

3. Generate and import mock data:

```bash
cd ../..
python scripts/generate_mock_csv.py
cd apps/api
PYTHONPATH=. python scripts/import_csv.py ../../data/mock_positions.csv --replace
PYTHONPATH=. python scripts/compute_features.py
```

### Fetch Real Position Data

真实数据采集脚本使用 AKShare 获取交易所公开的会员持仓排名数据，并归一化为项目 CSV schema。

```bash
cd apps/api
source .venv/bin/activate
pip install -r requirements.txt

# 获取单日指定品种
PYTHONPATH=. python scripts/fetch_real_positions.py --date 20260904 --symbols RB HC CU AL M Y OI --output ../../data/real_positions.csv

# 获取一段交易日，并直接导入数据库、重算 Feature
PYTHONPATH=. python scripts/fetch_real_positions.py --start 20260901 --end 20260904 --symbols RB HC CU AL M Y OI --output ../../data/real_positions.csv --import-db
```

注意：不同交易所公布粒度不同。大商所公布品种总排名；上期所通常按合约公布，脚本会按品种聚合；郑商所数据以交易所原始返回为准。

4. Run the API:

```bash
cd apps/api
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

5. Run the web app:

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

### 油脂真实历史数据

在 `apps/api` 目录运行（数据库连接由 `DATABASE_URL` 或后端 `.env` 指定）：

```bash
PYTHONPATH=. .venv/bin/python scripts/fetch_real_positions.py --symbols P OI Y --start 20260727 --end 20260904 --source eastmoney --output ../../data/real_oils_20260727_20260904.csv --import-db
```

- `P` 棕榈油、`OI` 菜油、`Y` 豆油；东方财富公开持仓排名数据按品种聚合不同合约，再按多空持仓之和取前 20 席位，并非单一主力合约或全市场持仓。
- 日期范围按工作日请求，不自动识别节假日。显式 `eastmoney` 模式遇到失败或任一品种缺失会终止，保留原数据库。
- 默认只替换 CSV 覆盖的品种和日期，保留其他历史；原始数据及 Feature 在同一事务提交。
- 首次从 mock 切换真实历史时，先备份数据库，再添加 `--replace-symbols`，明确清除这些品种旧数据，避免真假数据混合。
- 前端默认通过同源 `/api` 转发后端，不再要求浏览器直接连接 `localhost:8000`。后端不在本机时设置前端服务端环境变量 `API_INTERNAL_URL`，修改后重启 Next.js。

### CTA Bar 导入

CTA 只读取已收盘 Bar。先在 `/cta/contracts/{contract}` 配置真实交易合约、乘数、最小变动、最后交易日、保证金与涨跌停比例，再导入 D1、H1、M30 Bar。

```bash
cd apps/api
DATABASE_URL=sqlite:////absolute/path/to/dev.db PYTHONPATH=. .venv/bin/python scripts/import_cta_bars.py ../../data/cta_bars_template.csv
```

CSV 列：`contract,timeframe,close_time,open,high,low,close,volume,open_interest,is_final,source,source_time`。其中 `timeframe` 只接受 `D1`、`H1`、`M30`；需要至少 20 根日线、20 根 1H、20 根 30min 和 3 个交易日的席位数据。缺少任何关键输入时，系统返回 `DATA_INCOMPLETE`。

### CTA 天勤行情导入

在 `apps/api/.env` 中配置 `TQSDK_USER` 与 `TQSDK_PASSWORD` 后，可直接拉取真实合约的已收盘 K 线。账号密码只从环境变量读取，不会写入数据库或日志。

```bash
cd apps/api
PYTHONPATH=. .venv/bin/python scripts/fetch_tqsdk_cta_bars.py
```

Beta 默认同步 `P2701`（棕榈油）、`OI2701`（菜油）和 `Y2701`（豆油）。每个合约写入最近 60 根 D1 及各 240 根 1H、30min K 线；最后一根未收盘 Bar 会被排除。单合约补数示例：

```bash
PYTHONPATH=. .venv/bin/python scripts/fetch_tqsdk_cta_bars.py --contracts P2701
```

## Notes

- 默认最近交易日来自数据库中指定品种的最大 `date`。
- 多空评分为 Beta 简化规则：`50 + 50 * (long_change - short_change) / (abs(long_change) + abs(short_change))`。
- 趋势状态：评分大于等于 60 为 `Bullish`，小于等于 40 为 `Bearish`，否则为 `Neutral`。
- 今日总结暂不接 AI，仅基于连续增仓、集中度和趋势状态生成。

## Extension Points

- 实时行情：新增行情表与 `/market` API，不影响持仓结构表。
- AI 分析：在 `app/services/analysis.py` 外增加独立 summary provider。
- 事件系统：以 feature rebuild 后的信号为输入，落库到 event table。
- 移仓分析：新增合约维度，并按主力合约切换逻辑聚合。
- 预警系统：基于 concentration、net_change、streak 等 feature 触发。
