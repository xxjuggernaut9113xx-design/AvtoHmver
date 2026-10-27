#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace fanservice::checked {
inline constexpr std::array<std::size_t, 6> offsets{792, 56, 80, 120, 144, 168};
inline constexpr std::int32_t limit = 64;
inline constexpr char element_identity[] = "TScriptDelegate<FNotThreadSafeNotCheckedDelegateMode>";
inline constexpr std::uint32_t element_pdb_type = 0x10d3d;
inline constexpr std::uint32_t array_pdb_type = 0x15155;
struct Arguments { std::int64_t object; std::int64_t kind; std::int64_t index; };
template<class ReadInteger> Arguments read_arguments(ReadInteger read) {
    auto index = read(3);
    auto kind = read(2);
    auto object = read(1);
    return {object,kind,index};
}
struct Header { std::uintptr_t data; std::int32_t count; std::int32_t capacity; };
struct Entry { std::array<std::byte, 8> object; std::array<std::byte, 8> name; };
static_assert(sizeof(Header) == 16);
static_assert(sizeof(Entry) == 16 && offsetof(Entry, object) == 0 && offsetof(Entry, name) == 8);
inline std::uintptr_t add(std::uintptr_t base, std::size_t offset) {
    if (!base || offset > std::numeric_limits<std::uintptr_t>::max() - base) throw std::runtime_error("Checked delegate pointer range overflow.");
    return base + offset;
}
inline void validate(const Header& h) {
    if (h.count < 0 || h.capacity < h.count || h.capacity < 0 || h.count > limit || h.capacity > limit)
        throw std::runtime_error("Checked delegate count/capacity is outside the fixed 64-entry contract.");
    if (h.data && h.data % alignof(std::uintptr_t)) throw std::runtime_error("Checked delegate data is unaligned.");
    if (h.capacity && !h.data) throw std::runtime_error("Checked delegate has no entry storage.");
    if (h.capacity) add(h.data, static_cast<std::size_t>(h.capacity) * sizeof(Entry));
}
inline std::uintptr_t header_address(std::uintptr_t object, std::int64_t kind) {
    if (kind < 0 || kind >= static_cast<std::int64_t>(offsets.size()) || object % alignof(std::uintptr_t)) throw std::runtime_error("Checked delegate object/kind is invalid.");
    return add(add(object, offsets[static_cast<std::size_t>(kind)]), 8);
}
inline std::uintptr_t entry_address(const Header& h, std::int64_t index) {
    validate(h);
    if (index < 1 || index > h.count) throw std::runtime_error("Checked delegate index is unavailable.");
    return add(h.data, static_cast<std::size_t>(index - 1) * sizeof(Entry));
}
inline bool same(const Header& a, const Header& b) { return a.data == b.data && a.count == b.count && a.capacity == b.capacity; }
}
