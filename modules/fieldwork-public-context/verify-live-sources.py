#!/usr/bin/env python3
"""Read-only smoke of the native module's actual HTTP request recipes.

No graph writes, credentials, scheduling, matching, or review-state changes.
The request compiler uses only the module's declared maps/static values and
literal latitude/longitude substitutions, matching native bridge semantics.
"""
import argparse
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request


def compile_requests(module, latitude, longitude):
    integrations = {i['integrationKey']: i for i in module['integrations']}
    for bridge in module['bridges']:
        if bridge['fromTypeKey'] != 'fieldwork_place':
            continue
        config = bridge['config']
        integration = integrations[config['integrationKey']]
        operation = next(o for o in integration['provision']['operations'] if o['id'] == config['operationId'])
        variables = {}
        for key, value in config['variableMap'].items():
            variables[key] = value['template'].replace('${body.latitude}', str(latitude)).replace('${body.longitude}', str(longitude))
        params = {target: variables[source] for source, target in operation.get('queryMap', {}).items() if source in variables}
        params.update(operation.get('queryStatic', {}))
        url = integration['provision']['baseUrl'].rstrip('/') + operation['pathTemplate'] + '?' + urllib.parse.urlencode(params)
        yield bridge, url


def fetch_context(module, latitude, longitude):
    output = []
    for bridge, url in compile_requests(module, latitude, longitude):
        request = urllib.request.Request(url, headers={'User-Agent': 'Gyri-Fieldwork-PublicContext/0.1'})
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
        if isinstance(payload, dict) and payload.get('error'):
            raise ValueError(f"Provider error for {bridge['edgeKind']}: {payload['error']}")
        items = payload
        for part in bridge['config'].get('responseItemsPath', '').split('.'):
            if part:
                items = items[part]
        if not isinstance(items, list):
            raise ValueError(f"Unexpected list shape for {bridge['edgeKind']}")
        expected_limit = bridge['config']['limit']
        if len(items) > expected_limit:
            raise ValueError(f"Provider exceeded bounded result size for {bridge['edgeKind']}")
        output.append({'edgeKind': bridge['edgeKind'], 'url': url, 'count': len(items), 'items': items})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--latitude', type=float, default=37.78969882428619)
    parser.add_argument('--longitude', type=float, default=-122.42077712714297)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not math.isfinite(args.latitude) or not math.isfinite(args.longitude) or not -90 <= args.latitude <= 90 or not -180 <= args.longitude <= 180:
        parser.error('Valid finite geographic coordinates are required')
    module = json.loads((Path(__file__).parent / 'module.v2.json').read_text())
    output = fetch_context(module, args.latitude, args.longitude)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps([{'edgeKind': o['edgeKind'], 'count': o['count']} for o in output]))


if __name__ == '__main__':
    main()
