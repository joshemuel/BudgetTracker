"""Cross-provider JSON-shape normalization for transaction extraction.

`response_format: json_object` forces a top-level object, so different models
return the requested array in different shapes. `_as_item_list` must flatten
all of them the same way.
"""
from __future__ import annotations

from app.services.intent import _as_item_list


_TX = {"type": "Expense", "category": "Coffee", "amount": 18900, "description": "Coffee"}


def test_bare_array_passes_through():
    assert _as_item_list([_TX]) == [_TX]


def test_single_object_is_wrapped():
    assert _as_item_list(_TX) == [_TX]


def test_deepseek_wrapped_array_is_unwrapped():
    # DeepSeek wraps the array under a key because json_object forbids a bare array.
    assert _as_item_list({"transactions": [_TX]}) == [_TX]


def test_arbitrary_wrapper_key_is_unwrapped():
    assert _as_item_list({"items": [_TX, _TX]}) == [_TX, _TX]


def test_empty_object_is_empty_list():
    assert _as_item_list({}) == []


def test_empty_array_is_empty_list():
    assert _as_item_list([]) == []


def test_non_dict_entries_are_dropped():
    assert _as_item_list([_TX, "garbage", 5, None]) == [_TX]


def test_unknown_scalar_payload_is_empty():
    assert _as_item_list("not json-ish") == []
