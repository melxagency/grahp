import asyncio
import os
from datetime import datetime, timezone

from telethon import TelegramClient
from supabase import create_client

api_id = int(os.getenv("TELEGRAM_API_ID"))
api_hash = os.getenv("TELEGRAM_API_HASH")

client = TelegramClient("telegram", api_id, api_hash)

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

# Cuantos mensajes recientes revisar por canal en cada corrida.
# Ajustable por variable de entorno si algun canal tiene mucho volumen de posts.
MENSAJES_POR_CANAL = int(os.getenv("MENSAJES_POR_CANAL", "50"))


def get_today_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def get_telegram_paginas():
    """Obtiene las paginas de Telegram (red_social = 1) desde community_paginas."""
    response = supabase.table("community_paginas") \
        .select("id,nombre,link") \
        .eq("red_social", 1) \
        .limit(1000) \
        .execute()
    return response.data


def get_post_ids_registrados(pagina_id):
    """Set de post_id ya registrados en services_registro_post_paginas para esta pagina."""
    response = supabase.table("services_registro_post_paginas") \
        .select("post_id") \
        .eq("pagina", pagina_id) \
        .execute()
    return {row["post_id"] for row in response.data}


def registrar_nuevo_post(pagina_id, post_id, fecha):
    """Inserta un post nuevo detectado en services_registro_post_paginas."""
    supabase.table("services_registro_post_paginas").insert({
        "pagina": pagina_id,
        "fecha_inicio": fecha,
        "post_id": post_id,
        "activo": True,
        "fecha_final": None,
    }).execute()


async def procesar_pagina(pagina, today, insights_payload):
    nombre = pagina["nombre"]
    link = pagina.get("link")
    pagina_id = pagina["id"]

    if not link:
        print(f"⚠️ {nombre} (id={pagina_id}) sin link, omitiendo")
        return

    print(f"\n➡️ Procesando canal: {nombre} ({link})")

    try:
        entity = await client.get_entity(link)
    except Exception as e:
        print(f"❌ No se pudo obtener el canal {nombre}: {e}")
        return

    registrados = get_post_ids_registrados(pagina_id)
    nuevos = 0
    revisados = 0

    async for mensaje in client.iter_messages(entity, limit=MENSAJES_POR_CANAL):
        # Solo interesan publicaciones reales del canal (tienen "views")
        if mensaje.views is None:
            continue

        post_id = str(mensaje.id)
        revisados += 1

        if post_id not in registrados:
            registrar_nuevo_post(pagina_id, post_id, today)
            registrados.add(post_id)
            nuevos += 1
            print(f"🆕 Nuevo post registrado: {post_id}")

        insights_payload.append({
            "post_id": post_id,
            "fecha": today,
            "vistas": mensaje.views,
            "share": mensaje.forwards or 0,
        })

    print(f"✅ {nombre}: {revisados} posts revisados, {nuevos} nuevos")
    await asyncio.sleep(2)


async def main():
    today = get_today_utc()
    print(f"📅 Fecha del reporte: {today}\n")

    await client.start()

    print("📡 Buscando paginas de Telegram (red_social=1) en community_paginas...")
    paginas = get_telegram_paginas()
    print(f"✅ {len(paginas)} paginas encontradas")

    insights_payload = []

    for pagina in paginas:
        await procesar_pagina(pagina, today, insights_payload)

    if insights_payload:
        print(f"\n🚀 Insertando {len(insights_payload)} registros en insights_acumulado_post_community_paginas_telegram...")
        result = supabase.table("insights_acumulado_post_community_paginas_telegram") \
            .insert(insights_payload) \
            .execute()
        print(f"✅ Inserción completada: {len(result.data)} filas")
    else:
        print("⚠️ No hay estadisticas de posts para insertar")

    supabase.table("system_logs").insert({
        "clasificacion": 1,
        "modulo": 1,
        "descripcion": "Reporte diario de publicaciones Telegram (vistas y shares)",
        "fecha": today,
    }).execute()
    print("📝 Log registrado en system_logs")

    await client.disconnect()
    print("\n🎉 Reporte diario de Telegram completado")


if __name__ == "__main__":
    asyncio.run(main())
