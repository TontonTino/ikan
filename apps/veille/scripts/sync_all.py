"""Synchronise toutes les Pages Facebook connectées."""

import asyncio
import json

from scraping_service.services.sync import sync_all


async def main() -> int:
    result = await sync_all()
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))