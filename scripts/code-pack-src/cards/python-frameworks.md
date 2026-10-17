---
language: python
library: django
version: original
source_url: https://synap.surf/code-pack/cards/python-frameworks
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## Django DEBUG {library=django}

Django DEBUG must be False in production. With DEBUG True, Django shows tracebacks to visitors and serves static files itself. Set the settings module with DJANGO_SETTINGS_MODULE. Keep the secret key out of the repository. ALLOWED_HOSTS must list the host names you serve.

## FastAPI path parameters {library=fastapi}

FastAPI path parameters come from the function arguments. A type annotation validates the value. @app.get("/items/{item_id}") with item_id: int rejects a path segment that is not an integer. A pydantic model as a body parameter reads the JSON body. The development server is started with uvicorn.

## Flask routes {library=flask}

Flask routes use @app.route. The development server from app.run is not the production server. Run a production app under a WSGI server. Request data is in request.args for the query string and request.form for a form body. Return a string or a tuple of body, status.
