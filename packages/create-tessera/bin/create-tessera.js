#!/usr/bin/env node
import process from 'node:process'
import { main } from '@pixelscriptio/tessera/cli'

process.exitCode = await main(['init', ...process.argv.slice(2)])
