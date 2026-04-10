from datetime import datetime
import json
import os
import msal

GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0'


def _load_cache_for_token_file(token_file, scopes):
    access_token_cache = msal.SerializableTokenCache()
    if os.path.exists(token_file):
        try:
            access_token_cache.deserialize(open(token_file, "r").read())
            token_detail = json.load(open(token_file,))
            saved_scopes = token_detail.get('Scopes', [])
            # Keep expired tokens in cache so MSAL can use refresh tokens silently.
            if saved_scopes and set(saved_scopes) != set(scopes):
                os.remove(token_file)
                access_token_cache = msal.SerializableTokenCache()
        except Exception:
            # Corrupt cache file: reset safely.
            try:
                os.remove(token_file)
            except Exception:
                pass
            access_token_cache = msal.SerializableTokenCache()
    return access_token_cache


def generate_access_token(flow, app_id, scopes, token_file='ms_graph_api_token.json', reconnect_only=False):
    access_token_cache = _load_cache_for_token_file(token_file, scopes)
    client = msal.PublicClientApplication(client_id=app_id, token_cache=access_token_cache)
    accounts = client.get_accounts()

    token_response = None
    if accounts:
        token_response = client.acquire_token_silent(scopes, accounts[0])

    if (not token_response or 'access_token' not in token_response):
        if reconnect_only:
            return {}
        if not flow:
            flow = client.initiate_device_flow(scopes=scopes)
        print('user_code: ' + flow['user_code'])
        token_response = client.acquire_token_by_device_flow(flow)

    with open(token_file, 'w') as _f:
        token_cache_data = json.loads(access_token_cache.serialize())
        token_cache_data['Scopes'] = scopes
        _f.write(json.dumps(token_cache_data, indent=2))

    return token_response


def generate_user_code(app_id, scopes, token_file='ms_graph_api_token.json'):
    access_token_cache = msal.SerializableTokenCache()
    access_token_cache = _load_cache_for_token_file(token_file, scopes)

    client = msal.PublicClientApplication(client_id=app_id, token_cache=access_token_cache)
    accounts = client.get_accounts()

    if accounts:
        token_response = client.acquire_token_silent(scopes, accounts[0])
        flow = client.initiate_device_flow(scopes=scopes)
        if not token_response or 'access_token' not in token_response:
            flow = client.initiate_device_flow(scopes=scopes)
            return flow
    else:
        flow = client.initiate_device_flow(scopes=scopes)
        return flow
