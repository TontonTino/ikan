from cryptography.fernet import Fernet

from scraping_service.core.crypto import decrypt_token, encrypt_token


def test_encrypt_decrypt_token():
    key = Fernet.generate_key().decode("ascii")
    encrypted = encrypt_token("test-token", key)

    assert encrypted != "test-token"
    assert decrypt_token(encrypted, key) == "test-token"


def test_multi_fernet_rotation_decrypts_old_key_and_encrypts_with_first():
    old_key = Fernet.generate_key().decode("ascii")
    new_key = Fernet.generate_key().decode("ascii")
    old_ciphertext = encrypt_token("test-token", old_key)

    rotated_ciphertext = encrypt_token("test-token", f"{new_key},{old_key}")

    assert rotated_ciphertext != old_ciphertext
    assert decrypt_token(old_ciphertext, f"{new_key},{old_key}") == "test-token"