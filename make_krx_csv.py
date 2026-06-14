import requests
import pandas as pd
from bs4 import BeautifulSoup

def get_market(market_name, sosok):
    rows = []
    page = 1

    while True:
        url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}"
        res = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
        res.encoding = "euc-kr"

        soup = BeautifulSoup(res.text, "html.parser")
        links = soup.select("a.tltle")

        if not links:
            break

        for link in links:
            name = link.text.strip()
            href = link.get("href", "")
            code = href.split("code=")[-1]

            if len(code) == 6:
                rows.append({
                    "code": code,
                    "name": name,
                    "market": market_name
                })

        print(f"{market_name} page {page} 완료")
        page += 1

    return rows

def main():
    rows = []
    rows.extend(get_market("KOSPI", 0))
    rows.extend(get_market("KOSDAQ", 1))

    df = pd.DataFrame(rows)
    df = df.drop_duplicates(subset=["code"], keep="first")
    df = df.sort_values(["market", "code"]).reset_index(drop=True)

    df.to_csv("krx_stocks.csv", index=False, encoding="utf-8-sig")

    print(f"완료: krx_stocks.csv 생성 / 총 {len(df)}개 종목")
    print(df.head(10).to_string(index=False))

if __name__ == "__main__":
    main()