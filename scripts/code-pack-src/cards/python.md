---
language: python
library: python
version: original
source_url: https://synap.surf/code-pack/cards/python
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## asyncio.run

Call asyncio.run with the coroutine to run a Python coroutine from synchronous code. asyncio.run creates a loop, runs the coroutine, and closes the loop. It raises RuntimeError if a loop is already running in that thread. Do not call asyncio.run from inside another coroutine. From inside async code, await the coroutine instead.

## ModuleNotFoundError

ModuleNotFoundError means the module is not on sys.path. Check the import name, the file name, and that the virtualenv you installed into is the interpreter you are running. A typo or a package installed in a different environment is the usual cause.

## Tracebacks

A Python traceback lists the newest frame last. Read the last file and line first. That line raised the exception. Frames above it are the callers. The exception type and message are on the final line.

## NoneType subscript

TypeError: 'NoneType' object is not subscriptable means a function returned None and the code indexed it. A function with no return statement returns None. Assign the result only when the function returns the value you meant to index.

## IndentationError

IndentationError means the indent does not match the block. Use spaces consistently, usually four per level. Do not mix tabs and spaces. The caret points at the line whose indent broke the block.

## pytest fixtures {library=pytest}

A pytest fixture default scope is function. Write @pytest.fixture above a function and name that function as a test argument. function scope runs the fixture once per test. session scope runs it once per pytest process. Use pytest.raises to assert that a test raises a specific exception.

## pip requirements {library=pip}

pip install -r requirements.txt installs the listed packages into the current environment. Create a venv first so the install does not change the system Python. Activate it, then run pip. Freeze a working environment with pip freeze.

## pathlib encoding

pathlib.Path.read_text reads a text file. Pass encoding='utf-8' when the file is UTF-8. The default encoding follows the locale unless Python is in UTF-8 mode, so an explicit encoding is the portable choice. write_text takes the same encoding argument.
