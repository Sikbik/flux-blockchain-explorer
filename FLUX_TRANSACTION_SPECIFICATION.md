# Flux Blockchain Transaction Specification
## Complete Byte-Level Documentation

**Document Version:** 2.0
**Date:** November 12, 2025
**Last Updated:** November 12, 2025 - Critical corrections to FluxNode transactions and fee calculations
**Author:** Compiled from empirical analysis, debugging sessions, and parser implementation
**Network:** Flux (Zelcash fork of Zcash Sapling)
**Status:**  VERIFIED AGAINST PRODUCTION PARSER CODE

---

## Table of Contents

1. [Overview](#overview)
2. [Block Structure](#block-structure)
3. [Transaction Versions](#transaction-versions)
4. [Version 1: Legacy Bitcoin-style Transactions](#version-1-legacy-bitcoin-style-transactions)
5. [Version 2: Sprout Shielded Transactions](#version-2-sprout-shielded-transactions)
6. [Version 3: FluxNode Transactions](#version-3-fluxnode-transactions)
7. [Version 4: Sapling Transactions](#version-4-sapling-transactions)
8. [Version 5: FluxNode Update Transactions](#version-5-fluxnode-update-transactions)
9. [Version 6: FluxNode Confirm Transactions](#version-6-fluxnode-confirm-transactions)
10. [Data Types and Encoding](#data-types-and-encoding)
11. [Critical Flux-Specific Modifications](#critical-flux-specific-modifications)
12. [Block Header Parsing](#block-header-parsing)
13. [Common Pitfalls and Debugging](#common-pitfalls-and-debugging)

---

## Overview

Flux is a modified Zcash Sapling implementation with custom FluxNode transaction types and Flux-specific modifications to shielded transaction formats. The blockchain supports 6 transaction versions, each with distinct structures and purposes.

### Key Characteristics

- **Genesis Block:** Block 0 (hardcoded, special coinbase rules)
- **First Mined Block:** Block 1
- **Sapling Activation Height:** Block 250,000
- **Equihash(144,5) Activation:** Block 125,111
- **ZelHash Activation:** Block 372,500
- **Maximum Block Size:** 2MB (2,097,152 bytes)
- **Block Time:** ~120 seconds (2 minutes)
- **Consensus:** Hybrid PoW + Proof-of-Node (PoN)
- **Shielded Pools:** Sprout (deprecated) and Sapling (active)

### Critical Differences from Zcash

1. **JoinSplit Ciphertext Size:** 549 bytes for v4 (vs 601 bytes in Zcash)
2. **FluxNode Transactions:** Custom versions 3, 5, 6 for node operations
3. **Block Header:** Extended with PoN fields for blocks >= version 100

---

## Block Structure

### Block Header

The block header varies by block version. All blocks share a common base structure, with extensions for PoW vs PoN blocks.

#### Common Header Fields (108 bytes base)

```
Offset | Size | Field                    | Type       | Description
-------|------|--------------------------|------------|----------------------------------
0      | 4    | nVersion                 | uint32_LE  | Block version (4 for PoW, >=100 for PoN)
4      | 32   | hashPrevBlock            | char[32]   | Previous block hash
36     | 32   | hashMerkleRoot           | char[32]   | Merkle root of transactions
68     | 32   | hashReserved/SaplingRoot | char[32]   | Pre-Sapling: zeros, Post-Sapling: Sapling tree root
100    | 4    | nTime                    | uint32_LE  | Unix timestamp
104    | 4    | nBits                    | uint32_LE  | Difficulty target
```

#### PoW Block Header Extension (version < 100)

```
Offset | Size     | Field          | Type       | Description
-------|----------|----------------|------------|----------------------------------
108    | 32       | nNonce         | char[32]   | Equihash nonce
140    | VarInt   | solution_size  | VarInt     | Equihash solution length in bytes
140+VS | solution_size | nSolution | bytes      | Equihash solution
```

**Equihash Variants by Block Height:**
- **Blocks 0-125,110:** Equihash(200,9) - ~1,344 bytes solution
- **Blocks 125,111-372,499:** Equihash(144,5) - ~100 bytes solution
- **Blocks 372,500+:** ZelHash(125,4) - ~168 bytes solution

#### PoN Block Header Extension (version >= 100)

```
Offset | Size   | Field               | Type       | Description
-------|--------|---------------------|------------|----------------------------------
108    | 32     | nodesCollateralHash | char[32]   | FluxNode collateral tx hash
140    | 4      | nodesCollateralIdx  | uint32_LE  | FluxNode collateral output index
144    | VarInt | sig_size            | VarInt     | Block signature length
144+VS | sig_size | blockSignature    | bytes      | FluxNode block signature
```

#### Transaction Count

After the header (PoW solution or PoN signature), the transaction count follows:

```
Offset        | Size   | Field    | Type   | Description
--------------|--------|----------|--------|----------------------------------
[after header]| VarInt | tx_count | VarInt | Number of transactions in block
```

### Block Parsing Example

**Block 278,091 (PoW, Equihash(144,5)):**

```
Position (hex chars) | Position (bytes) | Field              | Value (hex)
---------------------|------------------|--------------------|-------------
0-7                  | 0-3              | version            | 04000000 (4, little-endian)
8-71                 | 4-35             | prevBlock          | c5d6281d...
72-135               | 36-67            | merkleRoot         | ec33f103...
136-199              | 68-99            | saplingRoot        | 0ef4547e...
200-207              | 100-103          | nTime              | 7d6e5cf2
208-215              | 104-107          | nBits              | 3d4a1d40
216-279              | 108-139          | nNonce             | 40000018ec00...
280-281              | 140              | solution_size      | 64 (100 decimal)
282-481              | 141-240          | solution           | 0131875a... (100 bytes)
482-483              | 241              | tx_count           | 02 (2 transactions)
484+                 | 242+             | transactions       | [transaction data]
```

---

## Transaction Versions

Flux supports 6 transaction versions, each with a specific structure and purpose:

| Version | Type                  | Overwintered | Version Group ID | Description |
|---------|-----------------------|--------------|------------------|-------------|
| 1       | Legacy                | No           | N/A              | Standard Bitcoin-style transparent transactions |
| 2       | Sprout Shielded       | No           | N/A              | Zcash Sprout shielded transactions (pre-Sapling) |
| 3       | FluxNode Start        | No           | N/A              | FluxNode registration/start transaction |
| 4       | Sapling               | Yes          | 0x892f2085       | Zcash Sapling shielded transactions |
| 5       | FluxNode Update       | No           | N/A              | FluxNode IP/configuration update |
| 6       | FluxNode Confirm      | No           | N/A              | FluxNode confirmation transaction |

### Version Byte Reading

```python
# Read first 4 bytes as little-endian uint32
version_raw = read_uint32_le(buffer, offset)

# Check if overwintered (bit 31 set)
is_overwintered = (version_raw & 0x80000000) != 0

# Get actual version number (bits 0-30)
version_number = version_raw & 0x7FFFFFFF

# For overwintered transactions, read version group ID
if is_overwintered:
    version_group_id = read_uint32_le(buffer, offset + 4)
    offset += 8  # Skip both version and version group ID
else:
    offset += 4  # Skip just version
```

---

## Version 1: Legacy Bitcoin-style Transactions

**Used in:** Blocks 0 - present (for transparent transactions)
**Overwintered:** No
**Shielded Support:** No

### Structure

```
Offset | Size              | Field         | Type       | Description
-------|-------------------|---------------|------------|----------------------------------
0      | 4                 | nVersion      | uint32_LE  | Transaction version (0x01000000)
4      | VarInt            | vin_count     | VarInt     | Number of inputs
4+VS   | vin_count * ~148  | vin[]         | TxIn[]     | Transaction inputs
       | VarInt            | vout_count    | VarInt     | Number of outputs
       | vout_count * ~34+ | vout[]        | TxOut[]    | Transaction outputs
       | 4                 | nLockTime     | uint32_LE  | Lock time (block height or timestamp)
```

### Input Structure (TxIn)

```
Offset | Size    | Field             | Type       | Description
-------|---------|-------------------|------------|----------------------------------
0      | 32      | prevout_hash      | char[32]   | Hash of previous transaction
32     | 4       | prevout_index     | uint32_LE  | Index of output in previous tx
36     | VarInt  | script_sig_size   | VarInt     | Size of scriptSig
36+VS  | script_sig_size | scriptSig   | bytes      | Script signature
       | 4       | nSequence         | uint32_LE  | Sequence number (typically 0xFFFFFFFF)
```

**Typical scriptSig for P2PKH (71-73 bytes signature + 33-65 bytes pubkey):**
```
[1 byte: sig_length] [71-73 bytes: DER signature] [1 byte: pubkey_length] [33-65 bytes: public key]
```

**Coinbase Input (vin[0] for block reward):**
```
prevout_hash: 0x0000000000000000000000000000000000000000000000000000000000000000
prevout_index: 0xFFFFFFFF
scriptSig: [coinbase data - arbitrary, typically contains block height + pool info]
```

### Output Structure (TxOut)

```
Offset | Size    | Field              | Type       | Description
-------|---------|--------------------|-|-----------|-----------
0      | 8       | nValue             | int64_LE   | Amount in zatoshis (1 FLUX = 100,000,000 zatoshis)
8      | VarInt  | script_pubkey_size | VarInt     | Size of scriptPubKey
8+VS   | script_pubkey_size | scriptPubKey | bytes | Locking script
```

**Common scriptPubKey Types:**

**P2PKH (25 bytes) - Pay to Public Key Hash:**
```
76 a9 14 [20 bytes: pubkey hash] 88 ac
OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
```

**P2SH (23 bytes) - Pay to Script Hash:**
```
a9 14 [20 bytes: script hash] 87
OP_HASH160 <scriptHash> OP_EQUAL
```

**P2PK (35 bytes) - Pay to Public Key:**
```
21 [33 bytes: compressed pubkey] ac
<pubKey> OP_CHECKSIG
```

### Parsing Example

**Simple 1-input, 2-output transaction:**

```python
offset = 0

# Version
version = read_uint32_le(data, offset)  # 0x01000000
offset += 4

# Inputs
vin_count = read_varint(data, offset)  # 0x01 (1 input)
offset += vin_count.size

for i in range(vin_count.value):
    prevout_hash = data[offset:offset+32]
    offset += 32
    prevout_index = read_uint32_le(data, offset)
    offset += 4

    script_sig_size = read_varint(data, offset)
    offset += script_sig_size.size

    script_sig = data[offset:offset+script_sig_size.value]
    offset += script_sig_size.value

    sequence = read_uint32_le(data, offset)
    offset += 4

# Outputs
vout_count = read_varint(data, offset)  # 0x02 (2 outputs)
offset += vout_count.size

for i in range(vout_count.value):
    value = read_int64_le(data, offset)
    offset += 8

    script_pubkey_size = read_varint(data, offset)
    offset += script_pubkey_size.size

    script_pubkey = data[offset:offset+script_pubkey_size.value]
    offset += script_pubkey_size.value

# Locktime
locktime = read_uint32_le(data, offset)
offset += 4

# offset now points to the end of the transaction
```

### Transaction Size Limits

- **Minimum input size:** 41 bytes (empty scriptSig)
- **Typical input size:** ~148 bytes (P2PKH with signature)
- **Minimum output size:** 9 bytes (8 bytes value + 1 byte empty script)
- **Typical output size:** 34 bytes (P2PKH)
- **Maximum inputs in 2MB block:** ~13,500 typical P2PKH inputs
- **Maximum outputs in 2MB block:** ~58,000 minimal outputs

---

## Version 2: Sprout Shielded Transactions

**Used in:** Blocks 0 - 249,999 (Sprout era)
**Overwintered:** No
**Shielded Support:** Yes (Sprout JoinSplits)
**Status:** Deprecated after Sapling activation

### Structure

```
Offset | Size              | Field         | Type       | Description
-------|-------------------|---------------|------------|----------------------------------
0      | 4                 | nVersion      | uint32_LE  | Transaction version (0x02000000)
4      | VarInt            | vin_count     | VarInt     | Number of transparent inputs
4+VS   | varies            | vin[]         | TxIn[]     | Transparent inputs (same as v1)
       | VarInt            | vout_count    | VarInt     | Number of transparent outputs
       | varies            | vout[]        | TxOut[]    | Transparent outputs (same as v1)
       | 4                 | nLockTime     | uint32_LE  | Lock time
       | VarInt            | nJoinSplit    | VarInt     | Number of JoinSplit descriptions
       | nJoinSplit * 1802 | vJoinSplit[]  | JSDescription[] | JoinSplit descriptions
       | 32                | joinSplitPubKey | char[32] | JoinSplit public key (if nJoinSplit > 0)
       | 64                | joinSplitSig  | char[64]   | JoinSplit signature (if nJoinSplit > 0)
```

### JoinSplit Description (Sprout) - 1802 bytes each

**CRITICAL: Flux uses 601-byte ciphertexts (standard Zcash Sprout size)**

```
Offset | Size | Field           | Type       | Description
-------|------|-----------------|------------|----------------------------------
0      | 8    | vpub_old        | uint64_LE  | Value entering shielded pool (zatoshis)
8      | 8    | vpub_new        | uint64_LE  | Value leaving shielded pool (zatoshis)
16     | 32   | anchor          | char[32]   | Merkle tree root (note commitment tree)
48     | 32   | nullifier[0]    | char[32]   | First nullifier (spent note identifier)
80     | 32   | nullifier[1]    | char[32]   | Second nullifier
112    | 32   | commitment[0]   | char[32]   | First note commitment (new note)
144    | 32   | commitment[1]   | char[32]   | Second note commitment
176    | 32   | ephemeralKey    | char[32]   | Ephemeral Diffie-Hellman key
208    | 32   | randomSeed      | char[32]   | Random seed for note encryption
240    | 32   | mac[0]          | char[32]   | First message authentication code
272    | 32   | mac[1]          | char[32]   | Second message authentication code
304    | 192  | zkproof         | char[192]  | zk-SNARK proof (PHGR13, not Groth16)
496    | 296  | zkproof_rest    | char[296]  | Continuation of proof (total 296+192=488 bytes)
[NOTE: zkproof field is actually 296 bytes total, split above for clarity]
296    | 601  | ciphertext[0]   | char[601]  | First encrypted note ciphertext
897    | 601  | ciphertext[1]   | char[601]  | Second encrypted note ciphertext
1498   | ---  | [end]           | ---        | Total: 1802 bytes
```

**Corrected offsets (continuous):**
```
0      | 8    | vpub_old        | uint64_LE
8      | 8    | vpub_new        | uint64_LE
16     | 32   | anchor          | char[32]
48     | 64   | nullifiers      | char[64]   | Two 32-byte nullifiers
112    | 64   | commitments     | char[64]   | Two 32-byte commitments
176    | 32   | ephemeralKey    | char[32]
208    | 32   | randomSeed      | char[32]
240    | 64   | macs            | char[64]   | Two 32-byte MACs
304    | 296  | zkproof         | char[296]  | zk-SNARK proof (PHGR13)
600    | 601  | ciphertext[0]   | char[601]  | First encrypted note (FLUX STANDARD)
1201   | 601  | ciphertext[1]   | char[601]  | Second encrypted note (FLUX STANDARD)
1802   | ---  | [end]           | ---        | Total: 1802 bytes per JoinSplit
```

### Sprout Ciphertext Structure (601 bytes)

The 601-byte ciphertext contains encrypted note information:

```
Offset | Size | Field              | Description
-------|------|--------------------|---------------------------------
0      | 32   | ephemeralPublicKey | Sender's ephemeral public key
32     | 32   | encCiphertext      | Encrypted note plaintext
64     | 537  | memo + auth        | Encrypted memo field + authentication tags

Total: 601 bytes (standard Zcash Sprout)
```

### JoinSplit Public Key and Signature

After all JoinSplit descriptions (only if `nJoinSplit > 0`):

```
Offset | Size | Field           | Type       | Description
-------|------|-----------------|------------|----------------------------------
0      | 32   | joinSplitPubKey | char[32]   | Ed25519 public key for JoinSplits
32     | 64   | joinSplitSig    | char[64]   | Ed25519 signature over entire tx
```

### Parsing Example

```python
offset = 0

# Version
version = read_uint32_le(data, offset)  # 0x02000000
offset += 4

# Parse transparent inputs (same as v1)
vin_count = read_varint(data, offset)
offset += vin_count.size
offset += parse_vins(data, offset, vin_count.value)

# Parse transparent outputs (same as v1)
vout_count = read_varint(data, offset)
offset += vout_count.size
offset += parse_vouts(data, offset, vout_count.value)

# Locktime
locktime = read_uint32_le(data, offset)
offset += 4

# JoinSplits
nJoinSplit = read_varint(data, offset)
offset += nJoinSplit.size

for i in range(nJoinSplit.value):
    # Each JoinSplit is exactly 1802 bytes
    vpub_old = read_uint64_le(data, offset)
    offset += 8
    vpub_new = read_uint64_le(data, offset)
    offset += 8
    anchor = data[offset:offset+32]
    offset += 32
    nullifiers = data[offset:offset+64]  # 2 * 32 bytes
    offset += 64
    commitments = data[offset:offset+64]  # 2 * 32 bytes
    offset += 64
    ephemeralKey = data[offset:offset+32]
    offset += 32
    randomSeed = data[offset:offset+32]
    offset += 32
    macs = data[offset:offset+64]  # 2 * 32 bytes
    offset += 64
    zkproof = data[offset:offset+296]
    offset += 296
    ciphertext_0 = data[offset:offset+601]  # FLUX: 601 bytes
    offset += 601
    ciphertext_1 = data[offset:offset+601]  # FLUX: 601 bytes
    offset += 601

if nJoinSplit.value > 0:
    joinSplitPubKey = data[offset:offset+32]
    offset += 32
    joinSplitSig = data[offset:offset+64]
    offset += 64
```

### Key Points

1. **Sprout JoinSplits are always 1802 bytes each** (with 601-byte ciphertexts)
2. **JoinSplitPubKey and JoinSplitSig ONLY present if nJoinSplit > 0**
3. **vpub_old/vpub_new track value moving in/out of shielded pool**
4. **Each JoinSplit can spend 2 notes and create 2 notes**
5. **Deprecated after block 250,000** (Sapling activation)

---

## Version 3: FluxNode Transactions (LEGACY)

️ **UPDATED 2025-11-12:** Version 3 is LEGACY format. Modern FluxNode transactions use Version 5/6 with nType field.

**Used in:** Early blocks (deprecated)
**Overwintered:** No
**Purpose:** Legacy FluxNode registration (superseded by v5/v6)
**Status:** DEPRECATED - Use Version 5/6 with nType instead

### Important: FluxNode Transaction Versioning

FluxNode transactions are identified by **BOTH version number AND nType field**:

| Version | nType | Purpose | Status |
|---------|-------|---------|--------|
| 3 | (varies) | Legacy FluxNode operations | DEPRECATED |
| 5 or 6 | 2 | FluxNode START (registration) | CURRENT |
| 5 or 6 | 4 | FluxNode CONFIRMATION | CURRENT |

**Detection Logic:**
```python
# Check if transaction is FluxNode type
if version in [3, 5, 6]:
    nType = read_uint8(buffer, offset_after_version)

    if version == 3:
        # Legacy format (deprecated)
        return parse_legacy_fluxnode(buffer)
    elif nType == 2:
        # Modern START transaction
        return parse_fluxnode_start(buffer, version)
    elif nType == 4:
        # Modern CONFIRMATION transaction
        return parse_fluxnode_confirmation(buffer, version)
```

**RPC Detection:** FluxNode transactions may have **empty or undefined vin/vout arrays** in RPC responses!

```python
# In block parsing
if not isinstance(tx.get('vin'), list) or not isinstance(tx.get('vout'), list):
    # Likely a FluxNode transaction
    if tx.get('version') in [3, 5, 6]:
        # Parse as FluxNode transaction
        pass
```

### Legacy Structure (Version 3 - DEPRECATED)

```
Offset | Size    | Field             | Type       | Description
-------|---------|-------------------|------------|----------------------------------
0      | 4       | nVersion          | uint32_LE  | Transaction version (0x03000000)
4      | 1       | nType             | uint8      | FluxNode operation type (1=start, 101=P2SH)
5      | VarInt  | vin_count         | VarInt     | Number of inputs (typically 1)
5+VS   | varies  | vin[]             | TxIn[]     | Transaction inputs
       | VarInt  | vout_count        | VarInt     | Number of outputs
       | varies  | vout[]            | TxOut[]    | Transaction outputs
       | 4       | nLockTime         | uint32_LE  | Lock time
       | VarInt  | payload_size      | VarInt     | Size of FluxNode payload
       | payload_size | payload      | bytes      | FluxNode registration data
       | VarInt  | sig_size          | VarInt     | Size of collateral signature
       | sig_size | collateral_sig   | bytes      | Signature proving collateral ownership
```

### FluxNode Payload Structure

The payload contains FluxNode registration information:

```
Offset | Size    | Field             | Type       | Description
-------|---------|-------------------|------------|----------------------------------
0      | 32      | collateralHash    | char[32]   | Hash of collateral transaction
32     | 4       | collateralIndex   | uint32_LE  | Output index of collateral
36     | VarStr  | ip_address        | VarStr     | FluxNode IP address (IPv4 or IPv6)
       | 2       | port              | uint16_BE  | FluxNode port (typically 16125)
       | VarStr  | pubkey            | VarStr     | FluxNode public key (33 or 65 bytes)
       | 4       | sigTime           | uint32_LE  | Signature timestamp
```

**VarStr encoding:**
```
[VarInt: length] [length bytes: string data]
```

### FluxNode Operation Types (nType)

```
Type | Name          | Description
-----|---------------|------------------------------------------------------
1    | START         | Regular FluxNode start (P2PKH collateral)
101  | START_P2SH    | FluxNode start with P2SH multisig collateral
```

### Collateral Requirements

️ **CORRECTED 2025-11-12:** Previous documentation had incorrect values.

FluxNode collateral must be exactly one of these amounts (with ±1 FLUX tolerance for fees):

- **CUMULUS (Basic):** 1,000 FLUX (100,000,000,000 zatoshis)
- **NIMBUS (Super):** 12,500 FLUX (1,250,000,000,000 zatoshis)
- **STRATUS (BAMF):** 40,000 FLUX (4,000,000,000,000 zatoshis)

**Tier Detection Logic:**
```python
def determine_tier(collateral_satoshis):
    flux_amount = collateral_satoshis / 100_000_000

    if 999 <= flux_amount <= 1001:
        return 'CUMULUS'
    elif 12499 <= flux_amount <= 12501:
        return 'NIMBUS'
    elif 39999 <= flux_amount <= 40001:
        return 'STRATUS'
    else:
        return 'UNKNOWN'
```

### Parsing Example

```python
offset = 0

# Version
version = read_uint32_le(data, offset)  # 0x03000000
offset += 4

# nType
nType = read_uint8(data, offset)
offset += 1

# Parse inputs and outputs (same as v1)
offset += parse_vins(data, offset)
offset += parse_vouts(data, offset)

# Locktime
locktime = read_uint32_le(data, offset)
offset += 4

# FluxNode payload
payload_size = read_varint(data, offset)
offset += payload_size.size

payload_start = offset
collateralHash = data[offset:offset+32]
offset += 32
collateralIndex = read_uint32_le(data, offset)
offset += 4

ip_length = read_varint(data, offset)
offset += ip_length.size
ip_address = data[offset:offset+ip_length.value].decode('utf-8')
offset += ip_length.value

port = read_uint16_be(data, offset)
offset += 2

pubkey_length = read_varint(data, offset)
offset += pubkey_length.size
pubkey = data[offset:offset+pubkey_length.value]
offset += pubkey_length.value

sigTime = read_uint32_le(data, offset)
offset += 4

# Collateral signature
sig_size = read_varint(data, offset)
offset += sig_size.size
collateral_sig = data[offset:offset+sig_size.value]
offset += sig_size.value
```

---

## Version 4: Sapling Transactions

**Used in:** Blocks 250,000+ (Sapling era)
**Overwintered:** Yes
**Version Group ID:** 0x892f2085
**Shielded Support:** Yes (Sapling spends/outputs + legacy JoinSplits)

This is the most complex transaction type, supporting both new Sapling shielded operations and legacy Sprout JoinSplits.

### Structure Overview

```
1. Transaction Header (overwintered)
2. Transparent Inputs (vin)
3. Transparent Outputs (vout)
4. nLockTime
5. nExpiryHeight (Overwinter)
6. Sapling Fields (valueBalance + spends + outputs + bindingSig)
7. JoinSplits (legacy Sprout compatibility)
```

### Complete Structure

```
Offset | Size              | Field              | Type       | Description
-------|-------------------|--------------------|------------|----------------------------------
0      | 4                 | nVersion           | uint32_LE  | 0x80000004 (bit 31 set = overwintered)
4      | 4                 | nVersionGroupId    | uint32_LE  | 0x892f2085 (Sapling group ID)
8      | VarInt            | vin_count          | VarInt     | Number of transparent inputs
8+VS   | varies            | vin[]              | TxIn[]     | Transparent inputs
       | VarInt            | vout_count         | VarInt     | Number of transparent outputs
       | varies            | vout[]             | TxOut[]    | Transparent outputs
       | 4                 | nLockTime          | uint32_LE  | Lock time
       | 4                 | nExpiryHeight      | uint32_LE  | Block height after which tx is invalid
       | 8                 | valueBalance       | int64_LE   | Net value balance of Sapling spends/outputs
       | VarInt            | nShieldedSpend     | VarInt     | Number of Sapling spends
       | nShieldedSpend*384| vShieldedSpend[]   | SpendDesc[]| Sapling spend descriptions
       | VarInt            | nShieldedOutput    | VarInt     | Number of Sapling outputs
       | nShieldedOutput*948| vShieldedOutput[] | OutputDesc[]| Sapling output descriptions
       | 64                | bindingSig         | char[64]   | Binding signature (if nShieldedSpend > 0 OR nShieldedOutput > 0)
       | VarInt            | nJoinSplit         | VarInt     | Number of JoinSplit descriptions (legacy)
       | nJoinSplit * 1698 | vJoinSplit[]       | JSDescription[] | JoinSplit descriptions (FLUX MODIFIED)
       | 32                | joinSplitPubKey    | char[32]   | JoinSplit public key (if nJoinSplit > 0)
       | 64                | joinSplitSig       | char[64]   | JoinSplit signature (if nJoinSplit > 0)
```

### Sapling Spend Description - 384 bytes each

```
Offset | Size | Field           | Type       | Description
-------|------|-----------------|------------|----------------------------------
0      | 32   | cv              | char[32]   | Value commitment to value of input note
32     | 32   | anchor          | char[32]   | Root of Sapling note commitment tree
64     | 32   | nullifier       | char[32]   | Nullifier of input note (prevents double-spend)
96     | 32   | rk              | char[32]   | Randomized public key
128    | 192  | zkproof         | char[192]  | zk-SNARK proof (Groth16, not PHGR13!)
320    | 64   | spendAuthSig    | char[64]   | Spend authorization signature

Total: 384 bytes per Sapling spend
```

### Sapling Output Description - 948 bytes each

```
Offset | Size | Field           | Type       | Description
-------|------|-----------------|------------|----------------------------------
0      | 32   | cv              | char[32]   | Value commitment
32     | 32   | cmu             | char[32]   | Note commitment u-coordinate
64     | 32   | ephemeralKey    | char[32]   | Ephemeral Diffie-Hellman key
96     | 192  | zkproof         | char[192]  | zk-SNARK proof (Groth16)
288    | 580  | encCiphertext   | char[580]  | Encrypted note ciphertext
868    | 80   | outCiphertext   | char[80]   | Encrypted memo field

Total: 948 bytes per Sapling output
```

**CRITICAL DIFFERENCE from Sprout:**
- Sapling uses **Groth16** proofs (192 bytes) instead of PHGR13 (296 bytes)
- Sapling ciphertexts are **580 + 80 bytes** instead of 601 bytes
- Sapling is much more efficient than Sprout

### JoinSplit Description (Sapling v4) - 1698 bytes each

**CRITICAL: Flux v4 uses 549-byte ciphertexts (NOT 601 like Zcash!)**

This is a **Flux-specific modification** discovered through empirical testing.

```
Offset | Size | Field           | Type       | Description
-------|------|-----------------|------------|----------------------------------
0      | 8    | vpub_old        | uint64_LE  | Value entering shielded pool
8      | 8    | vpub_new        | uint64_LE  | Value leaving shielded pool
16     | 32   | anchor          | char[32]   | Merkle tree root
48     | 64   | nullifiers      | char[64]   | Two 32-byte nullifiers
112    | 64   | commitments     | char[64]   | Two 32-byte commitments
176    | 32   | ephemeralKey    | char[32]   | Ephemeral key
208    | 32   | randomSeed      | char[32]   | Random seed
240    | 64   | macs            | char[64]   | Two 32-byte MACs
304    | 296  | zkproof         | char[296]  | zk-SNARK proof (PHGR13, same as v2)
600    | 549  | ciphertext[0]   | char[549]  | First encrypted note (FLUX CUSTOM!)
1149   | 549  | ciphertext[1]   | char[549]  | Second encrypted note (FLUX CUSTOM!)
1698   | ---  | [end]           | ---        | Total: 1698 bytes per JoinSplit

Difference from v2 Sprout: -104 bytes (52 bytes per ciphertext)
Difference from Zcash v4: Same (-52 bytes per ciphertext)
```

### Binding Signature Requirement

The `bindingSig` (64-byte Ed25519 signature) is **ONLY present when:**
```
nShieldedSpend > 0  OR  nShieldedOutput > 0
```

If there are no Sapling spends/outputs, this field is **absent**, even for v4 transactions.

### Sapling Field Presence Rules

For **ALL v4 Sapling transactions** (version 4 with versionGroupId 0x892f2085):

```
ALWAYS present (even if counts are zero):
- valueBalance (8 bytes)
- nShieldedSpend (VarInt)
- nShieldedOutput (VarInt)

CONDITIONALLY present:
- bindingSig (64 bytes) - ONLY if nShieldedSpend > 0 OR nShieldedOutput > 0
```

**CRITICAL BUG TO AVOID:**
Do NOT use heuristics to detect Sapling fields! Early implementations tried to detect Sapling presence by checking if the first byte after expiryHeight was 0x00, but this breaks on transactions where valueBalance happens to start with non-zero bytes.

### Parsing Example

```python
offset = 0

# Header
version_raw = read_uint32_le(data, offset)
offset += 4
is_overwintered = (version_raw & 0x80000000) != 0
version_number = version_raw & 0x7FFFFFFF

if not is_overwintered or version_number != 4:
    raise ValueError("Not a Sapling v4 transaction")

version_group_id = read_uint32_le(data, offset)
offset += 4

if version_group_id != 0x892f2085:
    raise ValueError(f"Unexpected version group ID: {hex(version_group_id)}")

# Transparent inputs and outputs
offset += parse_vins(data, offset)
offset += parse_vouts(data, offset)

# Locktime and expiry
locktime = read_uint32_le(data, offset)
offset += 4
expiryHeight = read_uint32_le(data, offset)
offset += 4

# Sapling fields (ALWAYS present for v4)
valueBalance = read_int64_le(data, offset)
offset += 8

# Shielded spends
nShieldedSpend = read_varint(data, offset)
offset += nShieldedSpend.size

for i in range(nShieldedSpend.value):
    cv = data[offset:offset+32]
    offset += 32
    anchor = data[offset:offset+32]
    offset += 32
    nullifier = data[offset:offset+32]
    offset += 32
    rk = data[offset:offset+32]
    offset += 32
    zkproof = data[offset:offset+192]  # Groth16
    offset += 192
    spendAuthSig = data[offset:offset+64]
    offset += 64

# Shielded outputs
nShieldedOutput = read_varint(data, offset)
offset += nShieldedOutput.size

for i in range(nShieldedOutput.value):
    cv = data[offset:offset+32]
    offset += 32
    cmu = data[offset:offset+32]
    offset += 32
    ephemeralKey = data[offset:offset+32]
    offset += 32
    zkproof = data[offset:offset+192]  # Groth16
    offset += 192
    encCiphertext = data[offset:offset+580]
    offset += 580
    outCiphertext = data[offset:offset+80]
    offset += 80

# Binding signature (ONLY if there are spends or outputs)
if nShieldedSpend.value > 0 or nShieldedOutput.value > 0:
    bindingSig = data[offset:offset+64]
    offset += 64

# JoinSplits (legacy Sprout compatibility)
nJoinSplit = read_varint(data, offset)
offset += nJoinSplit.size

ciphertext_size = 549  # FLUX v4: 549 bytes (NOT 601!)

for i in range(nJoinSplit.value):
    vpub_old = read_uint64_le(data, offset)
    offset += 8
    vpub_new = read_uint64_le(data, offset)
    offset += 8
    anchor = data[offset:offset+32]
    offset += 32
    nullifiers = data[offset:offset+64]
    offset += 64
    commitments = data[offset:offset+64]
    offset += 64
    ephemeralKey = data[offset:offset+32]
    offset += 32
    randomSeed = data[offset:offset+32]
    offset += 32
    macs = data[offset:offset+64]
    offset += 64
    zkproof = data[offset:offset+296]  # PHGR13
    offset += 296
    ciphertext_0 = data[offset:offset+ciphertext_size]  # 549 bytes
    offset += ciphertext_size
    ciphertext_1 = data[offset:offset+ciphertext_size]  # 549 bytes
    offset += ciphertext_size

if nJoinSplit.value > 0:
    joinSplitPubKey = data[offset:offset+32]
    offset += 32
    joinSplitSig = data[offset:offset+64]
    offset += 64
```

### Common Sapling Transaction Patterns

**Pure transparent (no shielded operations):**
```
valueBalance = 0
nShieldedSpend = 0
nShieldedOutput = 0
nJoinSplit = 0
[NO bindingSig - absent!]
```

**Shielding (transparent → Sapling):**
```
valueBalance < 0 (value entering shielded pool)
nShieldedSpend = 0
nShieldedOutput > 0 (creating shielded notes)
bindingSig present
```

**Deshielding (Sapling → transparent):**
```
valueBalance > 0 (value leaving shielded pool)
nShieldedSpend > 0 (spending shielded notes)
nShieldedOutput = 0
bindingSig present
```

**Shielded transfer (Sapling → Sapling):**
```
valueBalance = 0 (no net change to pool)
nShieldedSpend > 0
nShieldedOutput > 0
bindingSig present
```

**Legacy JoinSplit (rare in Sapling era):**
```
valueBalance = 0
nShieldedSpend = 0
nShieldedOutput = 0
nJoinSplit > 0
joinSplitPubKey and joinSplitSig present
```

---

## Version 5/6, nType 2: FluxNode START Transactions

️ **COMPLETELY REWRITTEN 2025-11-12:** This section was previously incorrect.

**Used in:** All blocks (for FluxNode registration)
**Overwintered:** No
**Purpose:** Register and start a new FluxNode
**Versions:** 5 (older) or 6 (current)
**nType:** 2

### Structure Overview

FluxNode START transactions have NO standard vin/vout arrays in RPC responses. The entire transaction payload is custom FluxNode data.

```
Offset | Size    | Field             | Type       | Description
-------|---------|-------------------|------------|----------------------------------
0      | 4       | nVersion          | uint32_LE  | Transaction version (5 or 6)
4      | 1       | nType             | uint8      | Type = 2 (START)
5      | 4       | nFluxTxVersion    | uint32_LE  | Internal version (bit flags) - ONLY if version=6
9/5    | 32      | collateralHash    | char[32]   | Hash of collateral transaction
41/37  | 4       | collateralIndex   | uint32_LE  | Output index of collateral (0-based)
45/41  | varies  | keys/script       | varies     | Format depends on nFluxTxVersion flags
       | 4       | sigTime           | uint32_LE  | Signature timestamp
       | VarInt  | sig_length        | VarInt     | Signature length
       | varies  | signature         | bytes      | Collateral signature
       | varies  | delegate_data     | varies     | Delegate keys (if DELEGATES bit set)
```

### nFluxTxVersion Bit Flags (Version 6 only)

```
Bit    | Hex    | Name              | Description
-------|--------|-------------------|----------------------------------
0x01   | 0x0001 | NORMAL_BIT        | P2PKH collateral (normal)
0x02   | 0x0002 | P2SH_BIT          | P2SH multisig collateral
0x0100 | 0x0100 | DELEGATES_BIT     | Delegate feature enabled
```

**Internal Version Values:**
- `1` = NORMAL (same as bit 0x01)
- `2` = P2SH (same as bit 0x02)
- `0x0101` = NORMAL + DELEGATES
- `0x0102` = P2SH + DELEGATES

### Key/Script Format by Type

**NORMAL (P2PKH) Format:**
```
Offset | Size    | Field             | Type       | Description
-------|---------|-------------------|------------|----------------------------------
0      | VarInt  | collateralPubkey_len | VarInt  | Length of collateral pubkey
       | 33/65   | collateralPubkey  | bytes      | Collateral public key (compressed/uncompressed)
       | VarInt  | nodePubkey_len    | VarInt     | Length of node pubkey
       | 33/65   | nodePubkey        | bytes      | FluxNode public key
```

**P2SH (Multisig) Format:**
```
Offset | Size    | Field             | Type       | Description
-------|---------|-------------------|------------|----------------------------------
0      | VarInt  | nodePubkey_len    | VarInt     | Length of node pubkey
       | 33/65   | nodePubkey        | bytes      | FluxNode public key
       | VarInt  | redeemScript_len  | VarInt     | Length of redeem script
       | varies  | redeemScript      | bytes      | P2SH redeem script
```

### Delegate Data (if DELEGATES_BIT set)

```
Offset | Size    | Field             | Type       | Description
-------|---------|-------------------|------------|----------------------------------
0      | 1       | usingDelegates    | uint8      | 0=not using, 1=using delegates
1      | VarInt  | delegate_count    | VarInt     | Number of delegate keys (if usingDelegates=1)
       | varies  | delegate_keys[]   | VarSlice[] | Array of delegate public keys
```

### Complete Parsing Example (Version 6, NORMAL)

```python
offset = 0

# Version
version = read_uint32_le(data, offset)  # 0x06000000
offset += 4

# nType
nType = read_uint8(data, offset)  # 0x02
offset += 1

if nType != 2:
    raise ValueError("Not a START transaction")

# nFluxTxVersion (only for version 6)
nFluxTxVersion = None
if version == 6:
    nFluxTxVersion = read_uint32_le(data, offset)
    offset += 4

# Collateral outpoint
collateralHash = data[offset:offset+32]
offset += 32
collateralIndex = read_uint32_le(data, offset)
offset += 4

# Determine format from nFluxTxVersion
is_p2sh = False
is_normal = False
has_delegates = False

if nFluxTxVersion is not None:
    is_p2sh = (nFluxTxVersion == 2 or (nFluxTxVersion & 0x02) != 0)
    is_normal = (nFluxTxVersion == 1 or
                ((nFluxTxVersion & 0x01) != 0 and (nFluxTxVersion & 0x02) == 0))
    has_delegates = (nFluxTxVersion & 0x0100) != 0
else:
    # Version 5 - assume NORMAL
    is_normal = True

# Parse keys based on format
if is_p2sh:
    # P2SH format: nodePubkey + redeemScript
    pubkey_len = read_varint(data, offset)
    offset += pubkey_len.size
    nodePubkey = data[offset:offset+pubkey_len.value]
    offset += pubkey_len.value

    script_len = read_varint(data, offset)
    offset += script_len.size
    redeemScript = data[offset:offset+script_len.value]
    offset += script_len.value
elif is_normal:
    # NORMAL format: collateralPubkey + nodePubkey
    collateral_key_len = read_varint(data, offset)
    offset += collateral_key_len.size
    collateralPubkey = data[offset:offset+collateral_key_len.value]
    offset += collateral_key_len.value

    node_key_len = read_varint(data, offset)
    offset += node_key_len.size
    nodePubkey = data[offset:offset+node_key_len.value]
    offset += node_key_len.value

# sigTime
sigTime = read_uint32_le(data, offset)
offset += 4

# Signature
sig_len = read_varint(data, offset)
offset += sig_len.size
signature = data[offset:offset+sig_len.value]
offset += sig_len.value

# Delegates (if enabled)
if has_delegates:
    using_delegates = read_uint8(data, offset)
    offset += 1

    if using_delegates == 1:
        delegate_count = read_varint(data, offset)
        offset += delegate_count.size

        delegates = []
        for i in range(delegate_count.value):
            delegate_len = read_varint(data, offset)
            offset += delegate_len.size
            delegate_key = data[offset:offset+delegate_len.value]
            offset += delegate_len.value
            delegates.append(delegate_key)
```

---

## Version 5/6, nType 4: FluxNode CONFIRMATION Transactions

️ **COMPLETELY REWRITTEN 2025-11-12:** Previous structure was missing critical fields.

**Used in:** All blocks (for FluxNode confirmations)
**Overwintered:** No
**Purpose:** Confirm FluxNode after initial start and benchmark completion
**Versions:** 5 or 6
**nType:** 4

### Structure

FluxNode CONFIRMATION transactions have NO standard vin/vout arrays in RPC responses. The entire transaction payload is custom FluxNode data.

```
Offset | Size    | Field             | Type       | Description
-------|---------|-------------------|------------|----------------------------------
0      | 4       | nVersion          | uint32_LE  | Transaction version (5 or 6)
4      | 1       | nType             | uint8      | Type = 4 (CONFIRMATION)
5      | 32      | collateralHash    | char[32]   | Hash of collateral transaction
37     | 4       | collateralIndex   | uint32_LE  | Output index of collateral
41     | 4       | sigTime           | uint32_LE  | Confirmation timestamp
45     | 1       | benchmarkTier     | int8       | Tier (1=CUMULUS, 2=NIMBUS, 3=STRATUS)
46     | 4       | benchmarkSigTime  | uint32_LE  | Benchmark signature timestamp
50     | 1       | nUpdateType       | int8       | Update type
51     | VarInt  | ip_length         | VarInt     | IP address string length
       | ip_length | ipAddress       | UTF-8      | FluxNode IP address
       | VarInt  | sig_length        | VarInt     | Signature length
       | sig_length | signature      | bytes      | Node signature
       | VarInt  | benchSig_length   | VarInt     | Benchmark signature length
       | benchSig_length | benchmarkSig | bytes  | Benchmark signature
```

### Benchmark Tier Values

```
Value | Tier Name | Collateral
------|-----------|------------
1     | CUMULUS   | 1,000 FLUX
2     | NIMBUS    | 12,500 FLUX
3     | STRATUS   | 40,000 FLUX
```

### Complete Parsing Example

```python
offset = 0

# Version
version = read_uint32_le(data, offset)  # 0x05000000 or 0x06000000
offset += 4

# nType
nType = read_uint8(data, offset)  # 0x04
offset += 1

if nType != 4:
    raise ValueError("Not a CONFIRMATION transaction")

# Collateral outpoint (COutPoint: 32-byte hash + 4-byte index)
collateralHash = data[offset:offset+32].reverse()  # Reverse for display
offset += 32
collateralIndex = read_uint32_le(data, offset)
offset += 4

# Signature time (uint32_t - 4 bytes)
sigTime = read_uint32_le(data, offset)
offset += 4

# Benchmark tier (int8_t - 1 byte)
# 1=CUMULUS, 2=NIMBUS, 3=STRATUS
benchmarkTierNum = read_int8(data, offset)
offset += 1

tier_names = {1: 'CUMULUS', 2: 'NIMBUS', 3: 'STRATUS'}
benchmarkTier = tier_names.get(benchmarkTierNum, 'UNKNOWN')

# Benchmark signature time (uint32_t - 4 bytes)
benchmarkSigTime = read_uint32_le(data, offset)
offset += 4

# Update type (int8_t - 1 byte)
nUpdateType = read_int8(data, offset)
offset += 1

# IP address (std::string - VarInt length + UTF-8 data)
ip_length = read_varint(data, offset)
offset += ip_length.size

ipAddress = ''
if ip_length.value > 0:
    ipAddress = data[offset:offset+ip_length.value].decode('utf-8')
    offset += ip_length.value

# Signature (std::vector<unsigned char> - VarInt length + bytes)
sig_length = read_varint(data, offset)
offset += sig_length.size

signature = b''
if sig_length.value > 0:
    signature = data[offset:offset+sig_length.value]
    offset += sig_length.value

# Benchmark signature (std::vector<unsigned char> - VarInt length + bytes)
benchSig_length = read_varint(data, offset)
offset += benchSig_length.size

benchmarkSig = b''
if benchSig_length.value > 0:
    benchmarkSig = data[offset:offset+benchSig_length.value]
    offset += benchSig_length.value
```

---

## Data Types and Encoding

### Primitive Types

```
Type        | Size    | Byte Order     | Description
------------|---------|----------------|----------------------------------
uint8       | 1       | N/A            | Unsigned 8-bit integer
uint16_LE   | 2       | Little-endian  | Unsigned 16-bit integer
uint16_BE   | 2       | Big-endian     | Unsigned 16-bit integer
uint32_LE   | 4       | Little-endian  | Unsigned 32-bit integer
int64_LE    | 8       | Little-endian  | Signed 64-bit integer
uint64_LE   | 8       | Little-endian  | Unsigned 64-bit integer
char[N]     | N       | N/A            | Fixed-size byte array
```

### VarInt Encoding (CompactSize)

Variable-length integer encoding used throughout Flux/Bitcoin:

```
First Byte | Payload    | Total Size | Value Range
-----------|------------|------------|----------------------------------
0x00-0xFC  | (none)     | 1 byte     | 0 - 252
0xFD       | 2 bytes LE | 3 bytes    | 253 - 65,535
0xFE       | 4 bytes LE | 5 bytes    | 65,536 - 4,294,967,295
0xFF       | 8 bytes LE | 9 bytes    | 4,294,967,296 - 18,446,744,073,709,551,615
```

**Parsing Example:**

```python
def read_varint(buffer, offset):
    first_byte = buffer[offset]

    if first_byte < 0xFD:
        return {'value': first_byte, 'size': 1}
    elif first_byte == 0xFD:
        value = read_uint16_le(buffer, offset + 1)
        return {'value': value, 'size': 3}
    elif first_byte == 0xFE:
        value = read_uint32_le(buffer, offset + 1)
        return {'value': value, 'size': 5}
    else:  # 0xFF
        # Note: typically only read lower 32 bits for safety
        value = read_uint32_le(buffer, offset + 1)
        return {'value': value, 'size': 9}
```

**Examples:**

```
Value   | Encoding (hex)
--------|----------------
0       | 00
252     | FC
253     | FD FD 00
254     | FD FE 00
255     | FD FF 00
256     | FD 00 01
13499   | FD BB 34  (little-endian: 0x34BB)
65535   | FD FF FF
65536   | FE 00 00 01 00
```

### VarStr Encoding

Variable-length string, prefixed with VarInt length:

```
[VarInt: length] [length bytes: UTF-8 or binary data]
```

**Example:**

```
String: "flux.local"
Length: 10 (0x0A)
Encoding: 0A 66 6C 75 78 2E 6C 6F 63 61 6C
          ^^ VarInt length
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 10 bytes of data
```

### Hash Types

All hashes in Flux are **little-endian** when stored in raw transactions, but **big-endian** when displayed as hex strings.

**Example:**
```
Internal (bytes): 5a40ef55c74e747762a68b737f613f6c54fe910400d4dd444451a469626b1d03
Display (hex):    031d6b6269a4514444ddd4000491fe546c3f617f738ba66277744ec755ef405a
                  ^^ bytes reversed for display
```

---

## Critical Flux-Specific Modifications

### 1. JoinSplit Ciphertext Sizes

**Version 2 (Sprout):**
- **Flux:** 601 bytes per ciphertext (STANDARD Zcash Sprout)
- **Total JoinSplit size:** 1802 bytes

**Version 4 (Sapling):**
- **Flux:** 549 bytes per ciphertext (CUSTOM - 52 bytes smaller than Zcash)
- **Zcash:** 601 bytes per ciphertext (standard)
- **Total JoinSplit size:** 1698 bytes (Flux) vs 1802 bytes (Zcash)

**Discovery Method:**
This was determined empirically by parsing actual Flux blocks and comparing transaction sizes from RPC vs parsed lengths. The difference of -104 bytes (52 bytes × 2 ciphertexts) was consistent across all v4 JoinSplit transactions.

**Implementation:**

```python
def get_joinsplit_ciphertext_size(version, is_sapling_v4):
    if version == 2:
        return 601  # Sprout - standard Zcash
    elif version == 4 and is_sapling_v4:
        return 549  # Sapling v4 - FLUX CUSTOM
    else:
        return 601  # Fallback
```

### 2. Sapling Field Presence

**ALWAYS parse Sapling fields for v4 transactions:**

```python
version_raw = read_uint32_le(data, offset)
is_overwintered = (version_raw & 0x80000000) != 0
version_number = version_raw & 0x7FFFFFFF

if is_overwintered and version_number == 4:
    version_group_id = read_uint32_le(data, offset + 4)
    is_sapling_v4 = (version_group_id == 0x892f2085)

    if is_sapling_v4:
        # ALWAYS parse these fields, even if all counts are zero
        # [after locktime and expiryHeight]
        valueBalance = read_int64_le(data, offset)
        offset += 8

        nShieldedSpend = read_varint(data, offset)
        offset += nShieldedSpend.size
        # ... parse spends ...

        nShieldedOutput = read_varint(data, offset)
        offset += nShieldedOutput.size
        # ... parse outputs ...

        # Binding signature ONLY if there are spends or outputs
        if nShieldedSpend.value > 0 or nShieldedOutput.value > 0:
            bindingSig = data[offset:offset+64]
            offset += 64
```

**DO NOT use heuristics like checking if the first byte after expiryHeight is 0x00!**

### 3. Input/Output Count Limits

Early parser implementations used limits of 10,000 inputs/outputs to catch offset errors. However, Flux blocks can contain massive consolidation transactions:

**Observed real-world transaction:**
- Block 278,091
- Transaction: 4b9cf0de76b66379842cc9e6da9645d9f346e443d4674dedb4e1be517bc5efe5
- **13,499 inputs** (gathering UTXOs for consolidation)

**Theoretical maximums in 2MB block:**
- **Minimal inputs (41 bytes each):** ~48,000 inputs
- **Typical P2PKH inputs (148 bytes each):** ~13,500 inputs
- **Minimal outputs (34 bytes each):** ~58,000 outputs

**Recommended limits:**
```python
MAX_VIN_COUNT = 100000   # High enough for edge cases
MAX_VOUT_COUNT = 100000  # Still catches parser offset errors
```

### 4. FluxNode Transaction Types

Flux adds custom transaction versions for FluxNode operations:

```
Version | nType | Purpose                    | Unique Fields
--------|-------|----------------------------|----------------------------------
3       | 1     | FluxNode START (P2PKH)     | collateral, IP, port, pubkey
3       | 101   | FluxNode START (P2SH)      | multisig collateral support
5       | 2     | FluxNode UPDATE            | new IP, new port
6       | 3     | FluxNode CONFIRM           | benchmark tier, benchmark sig
```

These transactions include extra payload and signature fields after the standard transaction structure.

---

## Block Header Parsing

### Determining Header Size

The block header size varies based on block version:

```python
def parse_block_header(data, block_height):
    offset = 0

    # Common fields (108 bytes)
    block_version = read_uint32_le(data, offset)
    offset += 4
    prev_block = data[offset:offset+32]
    offset += 32
    merkle_root = data[offset:offset+32]
    offset += 32

    # hashReserved (pre-Sapling) or hashFinalSaplingRoot (post-Sapling)
    sapling_root = data[offset:offset+32]
    offset += 32

    nTime = read_uint32_le(data, offset)
    offset += 4
    nBits = read_uint32_le(data, offset)
    offset += 4

    # Branch on block version
    if block_version >= 100:
        # Proof-of-Node (PoN) header
        nodes_collateral_hash = data[offset:offset+32]
        offset += 32
        nodes_collateral_idx = read_uint32_le(data, offset)
        offset += 4

        sig_length = read_varint(data, offset)
        offset += sig_length.size

        block_signature = data[offset:offset+sig_length.value]
        offset += sig_length.value

    else:
        # Proof-of-Work (PoW) header
        nNonce = data[offset:offset+32]
        offset += 32

        solution_length = read_varint(data, offset)
        offset += solution_length.size

        # Validate solution length based on block height
        if block_height is not None:
            if block_height <= 125110:
                expected_max = 2000  # Equihash(200,9)
            elif block_height < 372500:
                expected_max = 200   # Equihash(144,5)
            else:
                expected_max = 300   # ZelHash(125,4)

            if solution_length.value > expected_max:
                raise ValueError(f"Invalid Equihash solution length: {solution_length.value}")

        solution = data[offset:offset+solution_length.value]
        offset += solution_length.value

    # Transaction count follows header
    tx_count = read_varint(data, offset)
    offset += tx_count.size

    # offset now points to first transaction
    return {
        'header_end': offset,
        'tx_count': tx_count.value,
        'block_version': block_version
    }
```

### Sapling Root Field

Block header byte 68-99 (32 bytes):

- **Blocks 0-249,999 (pre-Sapling):** Called `hashReserved`, typically all zeros
- **Blocks 250,000+ (post-Sapling):** Called `hashFinalSaplingRoot`, contains Sapling note commitment tree root

This field is **always present** in all block headers, regardless of Sapling activation.

---

## Common Pitfalls and Debugging

### 1. Off-by-One Errors in Transaction Parsing

**Problem:** Parser calculates first transaction ends at byte 425, but second transaction starts at byte 426, leaving a "mystery byte."

**Root Cause:** Misunderstanding of VarInt sizes or missing a 1-byte field.

**Solution:**
- Carefully trace through every field with byte-level precision
- Verify against RPC `getrawtransaction` output
- Check for conditional fields (bindingSig, joinSplitPubKey/Sig)

**Debugging technique:**
```python
# Extract transaction from block
block_hex = rpc.getblock(block_hash, 0)  # Raw hex
block_data = bytes.fromhex(block_hex)

# Parse header to find tx start
header_info = parse_block_header(block_data, block_height)
tx_start_offset = header_info['header_end']

# Extract first transaction using parser
parsed_tx_length = parse_transaction(block_data, tx_start_offset)

# Get same transaction from RPC
tx_hex = rpc.getrawtransaction(txid)
rpc_tx_length = len(tx_hex) // 2  # Hex chars to bytes

# Compare
if parsed_tx_length != rpc_tx_length:
    print(f"LENGTH MISMATCH: parsed={parsed_tx_length}, rpc={rpc_tx_length}")
    print(f"Difference: {parsed_tx_length - rpc_tx_length} bytes")
```

### 2. Unreasonable Input/Output Counts

**Problem:** Parser reads `vinCount = 13499` and throws "Unreasonable vinCount" error.

**Root Cause:** Limit set too low (10,000) doesn't account for large consolidation transactions.

**Solution:** Increase limits to 100,000 while still catching offset errors.

**Real-world example:**
```
Block: 278091
Txid: 4b9cf0de76b66379842cc9e6da9645d9f346e443d4674dedb4e1be517bc5efe5
Inputs: 13,499 (consolidating many small UTXOs)
Size: ~1.99 MB (nearly fills entire 2MB block)
```

### 3. Sapling Field Detection Heuristics

**Problem:** Parser tries to detect if Sapling fields are present by checking if first byte after `expiryHeight` is `0x00`.

**Root Cause:** This heuristic breaks when `valueBalance` starts with a non-zero byte.

**Solution:** **ALWAYS parse Sapling fields for v4 Sapling transactions** (version 4 with versionGroupId 0x892f2085).

**Incorrect approach:**
```python
# DON'T DO THIS!
if is_sapling_v4:
    first_byte = data[offset]
    has_sapling_fields = (first_byte == 0x00)

    if has_sapling_fields:
        # Parse Sapling fields
```

**Correct approach:**
```python
# ALWAYS parse Sapling fields for v4
if is_sapling_v4:
    valueBalance = read_int64_le(data, offset)
    offset += 8
    # ... continue parsing ...
```

### 4. JoinSplit Ciphertext Size

**Problem:** Parser uses 601-byte ciphertexts for v4 JoinSplits (Zcash standard) but Flux uses 549 bytes.

**Symptom:** Transaction length off by 104 bytes (52 × 2 ciphertexts) for each JoinSplit.

**Solution:**
```python
def get_joinsplit_ciphertext_size(version, is_sapling_v4):
    if is_sapling_v4:
        return 549  # FLUX v4 Sapling
    else:
        return 601  # v2 Sprout (standard)
```

**Discovery method:**
```
1. Parse transaction from block, get length L1
2. Get same transaction from RPC, get length L2
3. Calculate difference: diff = L1 - L2
4. If transaction has 1 JoinSplit: diff should be ±104 bytes
5. Divide by 2 ciphertexts: 104 / 2 = 52 bytes per ciphertext
6. Standard size: 601 bytes
7. Flux size: 601 - 52 = 549 bytes
```

### 5. Binding Signature Conditional Presence

**Problem:** Parser always reads 64-byte bindingSig after Sapling outputs, even when counts are zero.

**Symptom:** Reading garbage data as bindingSig, offset gets misaligned.

**Solution:**
```python
# bindingSig is ONLY present when there are spends OR outputs
if nShieldedSpend.value > 0 or nShieldedOutput.value > 0:
    bindingSig = data[offset:offset+64]
    offset += 64
# Otherwise, skip it entirely
```

### 6. JoinSplit Public Key and Signature

**Problem:** Parser always reads joinSplitPubKey and joinSplitSig after JoinSplits.

**Symptom:** Offset misalignment when `nJoinSplit = 0`.

**Solution:**
```python
# These fields are ONLY present when nJoinSplit > 0
if nJoinSplit.value > 0:
    # ... parse all JoinSplits ...

    joinSplitPubKey = data[offset:offset+32]
    offset += 32
    joinSplitSig = data[offset:offset+64]
    offset += 64
```

### 7. Equihash Solution Length Validation

**Problem:** Parser reads wrong solution length, causing massive offset error.

**Root Cause:** Misaligned read of VarInt after nNonce.

**Solution:** Validate solution length against expected range for block height:

```python
solution_length = read_varint(data, offset)

if block_height <= 125110:
    expected_max = 2000
elif block_height < 372500:
    expected_max = 200
else:
    expected_max = 300

if solution_length.value > expected_max:
    raise ValueError(f"Invalid solution length {solution_length.value} at height {block_height}")
```

### 8. Block Header PoW vs PoN Detection

**Problem:** Parser assumes all blocks use PoW header structure.

**Symptom:** Fails to parse PoN blocks (version >= 100) correctly.

**Solution:**
```python
block_version = read_uint32_le(data, 0)

if block_version >= 100:
    # PoN header: nodesCollateral + signature
    offset = 144  # After nodesCollateral fields
    sig_length = read_varint(data, offset)
    offset += sig_length.size + sig_length.value
else:
    # PoW header: nNonce + Equihash solution
    offset = 140  # After nNonce
    solution_length = read_varint(data, offset)
    offset += solution_length.size + solution_length.value

# Now at transaction count
tx_count = read_varint(data, offset)
```

---

## Testing and Validation

### Test Vectors

**Block 278,091 - Large consolidation transaction:**
```
Block hash: 0000002a98ae046e960724ff6a84c57ccfa43a19c30c0d17b3fdc1eb2f9d8849
Height: 278091
Version: 4 (PoW)
Tx count: 2
Tx 1 (coinbase): 6315ef37d408c710832ee11f14e00208868610af106fd1021c656c64951b3a9c
  - Version: 4 (Sapling v4)
  - Size: 184 bytes
  - Vout count: 13,501 (mining pool payout)
Tx 2 (consolidation): 4b9cf0de76b66379842cc9e6da9645d9f346e443d4674dedb4e1be517bc5efe5
  - Version: 4 (Sapling v4)
  - Size: 1,992,951 bytes
  - Vin count: 13,499 (consolidating UTXOs)
  - No JoinSplits, no Sapling spends/outputs
```

**Block 213,548 - Sprout JoinSplit transaction:**
```
Block hash: [from previous debugging]
Txid: c7fd325aa8e266f876a8e69421585c951c582e694358f0be1102fc8fb26bae73
Version: 2 (Sprout)
JoinSplit count: 1
JoinSplit ciphertext size: 601 bytes (standard)
vpub_old: 20248.4999 FLUX (entering shielded pool)
vpub_new: 0 FLUX
```

### Validation Checklist

When implementing a Flux transaction parser:

- [ ] Correctly detects overwintered flag (bit 31)
- [ ] Reads version group ID for overwintered transactions
- [ ] Parses all 6 transaction versions
- [ ] Uses 601-byte ciphertexts for v2 Sprout JoinSplits
- [ ] Uses 549-byte ciphertexts for v4 Sapling JoinSplits
- [ ] Always parses Sapling fields for v4 (no heuristics)
- [ ] Conditionally reads bindingSig (only if spends/outputs exist)
- [ ] Conditionally reads joinSplitPubKey/Sig (only if JoinSplits exist)
- [ ] Supports up to 100,000 inputs/outputs
- [ ] Handles both PoW and PoN block headers
- [ ] Validates Equihash solution length by block height
- [ ] Correctly calculates transaction sizes (matches RPC)
- [ ] Handles FluxNode transaction payloads (v3, v5, v6)

### RPC Verification

Always verify parsed transactions against RPC output:

```python
# Get transaction from block parser
parsed_tx = parse_transaction_from_block(block_data, tx_offset)

# Get same transaction from RPC
rpc_tx_hex = rpc.getrawtransaction(txid)
rpc_tx_data = bytes.fromhex(rpc_tx_hex)

# Compare
assert parsed_tx['hex'] == rpc_tx_hex, "Transaction hex mismatch"
assert parsed_tx['size'] == len(rpc_tx_data), "Transaction size mismatch"

# Also compare decoded fields
rpc_decoded = rpc.getrawtransaction(txid, 1)
assert parsed_tx['version'] == rpc_decoded['version']
assert len(parsed_tx['vin']) == len(rpc_decoded['vin'])
assert len(parsed_tx['vout']) == len(rpc_decoded['vout'])
```

---

## Appendix: Quick Reference

### Transaction Version Summary

| Version | nType | Name | Overwintered | Fields |
|---------|-------|------|--------------|--------|
| 1 | N/A | Legacy | No | vin, vout, locktime |
| 2 | N/A | Sprout | No | vin, vout, locktime, JoinSplits (601-byte ciphertexts) |
| 3 | varies | FluxNode (LEGACY) | No | Legacy FluxNode format (deprecated) |
| 4 | N/A | Sapling | Yes (0x892f2085) | vin, vout, locktime, expiry, Sapling, JoinSplits (549-byte ciphertexts) |
| 5/6 | 2 | FluxNode START | No | collateral, keys, signature, delegates (optional) |
| 5/6 | 4 | FluxNode CONFIRMATION | No | collateral, tier, IP, signatures |

### Size Constants

```
Sprout JoinSplit (v2):        1802 bytes
Sapling JoinSplit (v4):       1698 bytes (-104 bytes)
Sapling Spend:                 384 bytes
Sapling Output:                948 bytes
Sprout ciphertext:             601 bytes
Sapling JoinSplit ciphertext:  549 bytes (FLUX)
Sapling output ciphertext:     580 + 80 bytes
Groth16 proof:                 192 bytes
PHGR13 proof:                  296 bytes
Ed25519 signature:              64 bytes
Ed25519 public key:             32 bytes
```

### Field Presence Rules

**v4 Sapling:**
```
ALWAYS:
- valueBalance (8 bytes)
- nShieldedSpend (VarInt)
- nShieldedOutput (VarInt)
- nJoinSplit (VarInt)

CONDITIONAL:
- bindingSig (64 bytes) - if nShieldedSpend > 0 OR nShieldedOutput > 0
- joinSplitPubKey (32 bytes) - if nJoinSplit > 0
- joinSplitSig (64 bytes) - if nJoinSplit > 0
```

**v2 Sprout:**
```
ALWAYS:
- nJoinSplit (VarInt)

CONDITIONAL:
- joinSplitPubKey (32 bytes) - if nJoinSplit > 0
- joinSplitSig (64 bytes) - if nJoinSplit > 0
```

---

## Implementation Guide: Fee Calculation and Shielded Pool Tracking

️ **NEW SECTION 2025-11-12:** Critical for correct indexer implementation.

### Fee Calculation for Shielded Transactions

Standard transparent transactions: `fee = inputTotal - outputTotal`

**Shielded transactions require accounting for pool flow:**

```
fee = inputTotal - outputTotal - shieldedPoolChange
```

Where `shieldedPoolChange` is calculated from:

### Sapling valueBalance (V4 Transactions)

**Semantics:**
- **Positive valueBalance:** Value LEAVING shielded pool → entering transparent pool
- **Negative valueBalance:** Value ENTERING shielded pool → leaving transparent pool

**For fee calculation:**
```python
# V4 Sapling transaction
valueBalance_satoshis = BigInt(round(tx.valueBalance * 1e8))

# shieldedPoolChange tracks NET FLOW OUT of pool
# Positive valueBalance = pool decreased (money left pool)
shieldedPoolChange = valueBalance_satoshis
```

**For supply tracking:**
```python
# SUBTRACT valueBalance from shielded pool
# Positive valueBalance = pool decreased
new_shielded_pool = prev_shielded_pool - valueBalance_satoshis
```

### JoinSplit vpub Values (V2/V4 Transactions)

**Semantics:**
- **vpub_old:** Value ENTERING shielded pool (from transparent)
- **vpub_new:** Value LEAVING shielded pool (to transparent)

**For fee calculation:**
```python
joinSplitChange = BigInt(0)
for joinsplit in tx.vjoinsplit:
    vpub_old_sat = BigInt(round(joinsplit.vpub_old * 1e8))
    vpub_new_sat = BigInt(round(joinsplit.vpub_new * 1e8))

    # Net flow: old (entering) - new (leaving)
    # Positive = net INTO pool, Negative = net OUT OF pool
    joinSplitChange += vpub_old_sat - vpub_new_sat

shieldedPoolChange += joinSplitChange
```

**Complete fee formula:**
```python
if is_coinbase:
    fee = 0
else:
    # Get valueBalance (V4 only)
    valueBalance_sat = parse_value_balance(tx) if tx.version == 4 else 0

    # Get JoinSplit changes (V2 or V4)
    joinsplit_change = parse_joinsplit_change(tx)

    # Total shielded pool change
    shielded_change = valueBalance_sat + joinsplit_change

    # Calculate fee
    # We SUBTRACT because:
    # - When shielding (change > 0): fee shouldn't include shielded amount
    # - When deshielding (change < 0): fee should account for deshielded amount
    fee = inputTotal - outputTotal - shielded_change

    # Clamp negative fees to 0 (shouldn't happen in valid transactions)
    if fee < 0:
        fee = 0
```

### Parser Sanity Checks

️ **CRITICAL:** Raw hex parsers can produce garbage values for JoinSplits when parsing large FluxNode transactions.

**Always sanity check parsed values:**

```python
MAX_REASONABLE_VALUE = 1_000_000_000 * 100_000_000  # 1 billion FLUX in satoshis

def sanity_check_joinsplit(vpub_old, vpub_new):
    """Check if JoinSplit values are reasonable"""
    abs_old = abs(vpub_old)
    abs_new = abs(vpub_new)

    if abs_old > MAX_REASONABLE_VALUE or abs_new > MAX_REASONABLE_VALUE:
        # Parser produced garbage
        return False
    return True

# In parsing code
parsed_joinsplits = parse_joinsplits_from_hex(tx_hex)

# Prefer RPC data when available
if tx.vjoinsplit and len(tx.vjoinsplit) > 0:
    # Use RPC data (more reliable)
    joinsplits = tx.vjoinsplit
elif parsed_joinsplits:
    # Use parsed data only if it passes sanity checks
    if all(sanity_check_joinsplit(js.vpub_old, js.vpub_new) for js in parsed_joinsplits):
        joinsplits = parsed_joinsplits
    else:
        # Parser produced garbage - treat as no JoinSplits
        logger.error(f"Insane JoinSplit values detected, ignoring parsed data for {tx.txid}")
        joinsplits = []
else:
    joinsplits = []
```

### RPC vs Hex Parsing Priority

**Always prefer RPC data over hex parsing:**

1. **RPC data (highest priority):**
   - `getblock(hash, 2)` - Full verbose block with transactions
   - `getrawtransaction(txid, true)` - Verbose transaction data
   - Most reliable, validated by daemon

2. **Hex parsing (fallback):**
   - Used when RPC doesn't provide data (e.g., JoinSplits with txindex=0)
   - Required for transaction sizes when missing from RPC
   - **Must be sanity checked**

3. **Hybrid approach (recommended):**
   ```python
   # Get transaction from block
   tx = block.tx[i]

   # Use RPC data when available
   if tx.vjoinsplit and len(tx.vjoinsplit) > 0:
       joinsplits = tx.vjoinsplit  # Use RPC
   else:
       # RPC didn't provide JoinSplits, parse from hex
       if not tx.hex:
           # Fetch raw block hex
           block_hex = rpc.getblock(block.hash, 0)
           tx.hex = extract_transaction_from_block(block_hex, tx.txid)

       if tx.hex:
           parsed = parse_transaction_shielded_data(tx.hex)
           # Sanity check before using
           if sanity_check_joinsplits(parsed.vjoinsplit):
               joinsplits = parsed.vjoinsplit
           else:
               joinsplits = []
       else:
           joinsplits = []
   ```

### BigInt Handling and PostgreSQL Limits

**PostgreSQL bigint limits:**
- Minimum: -9,223,372,036,854,775,808
- Maximum: 9,223,372,036,854,775,807

This represents approximately **92.2 billion FLUX** (with current supply ~440 million).

**Safe conversion:**

```python
MAX_BIGINT = 9_223_372_036_854_775_807

def safe_bigint_to_string(value: int, context: str = '') -> str:
    """Convert BigInt to string with overflow protection"""
    if value > MAX_BIGINT:
        logger.error(f"BigInt overflow: {value} > {MAX_BIGINT} (context: {context})")
        return str(MAX_BIGINT)  # Clamp to max
    if value < 0:
        logger.warn(f"Negative BigInt: {value} (context: {context})")
        return '0'  # Clamp to 0
    return str(value)

def to_satoshis(flux_value: float) -> int:
    """Convert FLUX to satoshis safely"""
    if flux_value is None or not isfinite(flux_value):
        return 0

    # Flux/Zcash can return -1 for shielded outputs
    clamped = max(0, flux_value)

    return int(round(clamped * 1e8))
```

**Overflow detection:**

```python
# Check for overflow before accumulating
new_total = current_total + new_value

if new_total > MAX_BIGINT or new_total < current_total:
    # Overflow detected!
    logger.error(f"Overflow: {current_total} + {new_value} = {new_total}")
    current_total = MAX_BIGINT
else:
    current_total = new_total
```

### Coinbase Transaction Rules

**Detection:**
```python
def is_coinbase(tx):
    return (len(tx.vin) > 0 and
            tx.vin[0].txid == '0' * 64 and
            tx.vin[0].vout == 0xFFFFFFFF)

# Or check for coinbase field
def is_coinbase_alt(tx):
    return len(tx.vin) > 0 and tx.vin[0].get('coinbase') is not None
```

**Coinbase rules:**
- Fee is always 0
- No input value to calculate
- outputTotal = block reward + transaction fees
- First transaction in every block

**Block reward calculation:**
```python
# Flux block rewards (simplified)
def get_block_reward(height):
    if height < 1000:
        return 0  # Special genesis period
    # Halving schedule...
    # (Simplified - actual logic is more complex)
    return base_reward
```

### UTXO Management

**Creating UTXOs:**
```python
for output in tx.vout:
    address = output.scriptPubKey.addresses[0] if output.scriptPubKey.addresses else None

    # Use placeholder for non-standard outputs
    utxo_address = address or 'SHIELDED_OR_NONSTANDARD'

    value_satoshis = to_satoshis(output.value)

    db.insert_utxo(
        txid=tx.txid,
        vout=output.n,
        address=utxo_address,
        value=safe_bigint_to_string(value_satoshis),
        script_pubkey=output.scriptPubKey.hex,
        script_type=output.scriptPubKey.type,
        block_height=block.height,
        spent=False
    )
```

**Spending UTXOs:**
```python
for input in tx.vin:
    if input.coinbase:
        continue  # Skip coinbase inputs

    db.mark_utxo_spent(
        txid=input.txid,
        vout=input.vout,
        spent_txid=tx.txid,
        spent_block_height=block.height
    )
```

**Same-block create-and-spend handling:**

Problem: UTXO created in transaction N and spent in transaction N+1 within same block.

Solution: Use temporary table and two-phase commit:
```sql
-- Phase 1: Prepare spent UTXOs in temp table
CREATE TEMP TABLE temp_spent_utxos (
    txid TEXT,
    vout INT,
    spent_txid TEXT,
    spent_block_height INT,
    PRIMARY KEY (txid, vout)
) ON COMMIT DROP;

-- Phase 2: Insert all new UTXOs

-- Phase 3: Mark UTXOs as spent from temp table
UPDATE utxos
SET spent = true, spent_txid = temp.spent_txid, spent_block_height = temp.spent_block_height
FROM temp_spent_utxos temp
WHERE utxos.txid = temp.txid AND utxos.vout = temp.vout;
```

---

## Document History

**v2.0 - November 12, 2025** ️ **CRITICAL UPDATE**
- **FIXED:** FluxNode collateral requirements (were completely wrong!)
  - Was: 10,000 / 25,000 / 100,000 FLUX
  - Now: 1,000 / 12,500 / 40,000 FLUX (CORRECT)
- **FIXED:** FluxNode transaction structure (completely rewritten)
  - Clarified version vs nType field usage
  - Documented modern Version 5/6 with nType 2/4 format
  - Added complete Version 6 START transaction structure
  - Fixed Version 5/6 CONFIRMATION structure (was missing 3 fields!)
- **ADDED:** Implementation Guide section
  - Fee calculation for shielded transactions
  - Shielded pool tracking with valueBalance semantics
  - Parser sanity checks for insane JoinSplit values
  - RPC vs hex parsing priority
  - BigInt handling and PostgreSQL limits
  - Coinbase transaction rules
  - UTXO management with same-block create-and-spend
- **VERIFIED:** All structures against production parser code
- **STATUS:** Now safe for use in production implementations

**v1.0 - October 30, 2025**
- Initial comprehensive specification
- Documented all 6 transaction versions
- Detailed Flux-specific modifications
- Added parsing examples and test vectors
- Included debugging guide and common pitfalls
- ️ **HAD CRITICAL ERRORS** - See v2.0 for corrections

**Sources:**
- Empirical analysis of Flux blockchain blocks 0-878,520
- RPC debugging sessions comparing parsed vs daemon output
- Analysis of FluxD source code (Zcash fork)
- Real-world debugging of production indexer failures
- **v2.0:** Direct analysis of production parser implementation (flux-indexer/src/parsers/)

---

## License and Usage

This specification is provided as-is for educational and development purposes. It documents the Flux blockchain protocol as observed through empirical analysis and may be used freely for implementing Flux-compatible software.

**Recommended citation:**
```
Flux Blockchain Transaction Specification v1.0 (2025)
Compiled through empirical analysis of Flux blockchain
```

For questions or corrections, refer to:
- Flux GitHub: https://github.com/RunOnFlux/fluxd
- Zcash Protocol Specification: https://zips.z.cash/protocol/protocol.pdf

---

**End of Specification**
