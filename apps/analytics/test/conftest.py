"""No external sockets in tests; only the configured Compose queue is reachable."""

import ipaddress
import os
import socket

import pytest


@pytest.fixture(autouse=True)
def queue_only_network(monkeypatch):
    host = os.environ.get("VALKEY_QUEUE_HOST", "localhost")
    port = int(os.environ.get("VALKEY_QUEUE_PORT", "6379"))
    resolve = socket.getaddrinfo
    allowed = {entry[4][0] for entry in resolve(host, port, type=socket.SOCK_STREAM)}
    connect = socket.socket.connect
    connect_ex = socket.socket.connect_ex
    sendto = socket.socket.sendto

    def check(address):
        if not isinstance(address, tuple) or len(address) < 2:
            raise OSError("Network blocked outside valkey-queue")
        target, target_port = address[:2]
        if target not in allowed | {host} or target_port != port:
            raise OSError("Network blocked outside valkey-queue")

    def guarded_connect(sock, address):
        check(address)
        return connect(sock, address)

    def guarded_connect_ex(sock, address):
        check(address)
        return connect_ex(sock, address)

    def guarded_sendto(sock, data, *args):
        check(args[-1])
        return sendto(sock, data, *args)

    def guarded_resolve(target, target_port, *args, **kwargs):
        check((target, target_port))
        return resolve(target, target_port, *args, **kwargs)

    # Windows asyncio creates a loopback socket pair before network clients start.
    # Keep that OS-local primitive available without permitting arbitrary connects.
    def local_pair(*args, **kwargs):
        monkeypatch.setattr(socket.socket, "connect", connect)
        monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
        try:
            return original_pair(*args, **kwargs)
        finally:
            monkeypatch.setattr(socket.socket, "connect", guarded_connect)
            monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)

    assert all(ipaddress.ip_address(address) for address in allowed)
    original_pair = socket.socketpair
    monkeypatch.setattr(socket, "socketpair", local_pair)
    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)
    monkeypatch.setattr(socket.socket, "sendto", guarded_sendto)
    monkeypatch.setattr(socket, "getaddrinfo", guarded_resolve)
