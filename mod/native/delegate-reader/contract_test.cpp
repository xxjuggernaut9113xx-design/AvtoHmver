#include "reader_contract.hpp"
#include <cstring>
#include <iostream>
#include <functional>
#include <vector>
#include <string_view>
using namespace fanservice::checked;
int main() {
    unsigned passed = 0;
    auto require = [&](bool ok) { if (!ok) throw std::runtime_error("Contract assertion failed."); ++passed; };
    auto rejected = [&](const std::function<void()>& fn) { bool caught=false; try { fn(); } catch (const std::runtime_error&) { caught=true; } require(caught); };
    for (auto expected : {Arguments{0x12345678,1,0},Arguments{0x87654321,5,3},Arguments{0x11223344,0,1}}) {
        std::vector<std::int64_t> stack{expected.object,expected.kind,expected.index};
        std::vector<int> reads;
        auto actual=read_arguments([&](int position) {
            reads.push_back(position);
            if(position<1 || position>static_cast<int>(stack.size()))throw std::runtime_error("Consumptive Lua index shifted.");
            auto value=stack[static_cast<std::size_t>(position-1)];stack.erase(stack.begin()+position-1);return value;
        });
        require(actual.object==expected.object && actual.kind==expected.kind && actual.index==expected.index);
        require(stack.empty());require(reads==std::vector<int>{3,2,1});
    }
    for (std::size_t k=0;k<offsets.size();++k) require(header_address(0x1000,k)==0x1000+offsets[k]+8);
    rejected([] { header_address(0x1000,-1); }); rejected([] { header_address(0x1000,6); }); rejected([] { header_address(0x1001,0); });
    rejected([] { add(UINTPTR_MAX-4,8); }); rejected([] { add(0,8); });
    Header empty{}; validate(empty); require(entry_address({0x1000,2,2},2)==0x1010);
    rejected([] { entry_address({0x1000,2,2},0); }); rejected([] { entry_address({0x1000,2,2},3); });
    for (Header h : {Header{0,-1,0},Header{0,1,1},Header{0x1000,2,1},Header{0x1000,65,65},Header{0x1000,0,65},Header{0x1001,1,1},Header{UINTPTR_MAX-7,1,1}})
        rejected([&] { validate(h); });
    require(same(empty,{})); require(!same({0x1000,1,1},{0x1000,1,2}));
    Entry e{}; std::uint64_t weak=0x8877665544332211, name=0x1122334455667788;
    std::memcpy(e.object.data(),&weak,8); std::memcpy(e.name.data(),&name,8);
    std::uint64_t copied=0; std::memcpy(&copied,reinterpret_cast<const std::byte*>(&e)+0,8);require(copied==weak);
    std::memcpy(&copied,reinterpret_cast<const std::byte*>(&e)+8,8);require(copied==name);
    require(sizeof(e)==16);
    require(std::string_view(element_identity)=="TScriptDelegate<FNotThreadSafeNotCheckedDelegateMode>");
    require(element_pdb_type==0x10d3d && array_pdb_type==0x15155);
    std::cout << passed << " checked-delegate layout/range contracts passed.\n";
}
