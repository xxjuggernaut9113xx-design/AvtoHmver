#pragma once
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>

namespace fanservice {
template<class Backend> class ScratchRoots {
    Backend backend;
    std::map<std::int64_t, typename Backend::Record> records;
    std::int64_t next = 1;
public:
    explicit ScratchRoots(Backend value = {}) : backend(std::move(value)) {}
    template<class Visitor> auto inspect(std::int64_t token,Visitor visitor) {
        auto slot=records.find(token);
        if(slot==records.end() || !backend.valid(slot->second) || !backend.rooted(slot->second))
            throw std::runtime_error("Scratch root inspection requires a live owned lease.");
        return visitor(slot->second);
    }
    std::pair<std::int64_t,std::uintptr_t> create(std::uintptr_t outer) {
        if(records.size()>=8 || next==INT64_MAX)throw std::runtime_error("Scratch root lease limit reached.");
        const auto token=next++;
        auto [slot,inserted]=records.try_emplace(token);
        if(!inserted)throw std::runtime_error("Scratch root token was reused.");
        bool attempted=false;
        try {
            slot->second=backend.create(outer);
            if(!backend.fresh(slot->second) || !backend.valid(slot->second) || backend.rooted(slot->second))
                throw std::runtime_error("Scratch root factory did not produce a fresh unrooted exact manager.");
            backend.require_idle(slot->second);
            attempted=true;
            backend.set_root(slot->second);
            if(!backend.valid(slot->second) || !backend.rooted(slot->second))throw std::runtime_error("Scratch root acquisition failed readback.");
            return {token,backend.address(slot->second)};
        } catch(...) {
            if(attempted) {
                try {
                    if(!backend.valid(slot->second))throw std::runtime_error("Scratch root identity changed.");
                    if(backend.rooted(slot->second)) {
                        backend.require_idle(slot->second);
                        backend.clear_root(slot->second);
                        if(backend.rooted(slot->second))throw std::runtime_error("Scratch root rollback failed.");
                    }
                } catch(...) {
                    throw std::runtime_error("Scratch root acquisition failed; lease token retained: "+std::to_string(token));
                }
            }
            records.erase(slot);
            throw;
        }
    }
    bool release(std::int64_t token) {
        auto slot=records.find(token);
        if(slot==records.end())return false;
        if(!backend.valid(slot->second) || !backend.rooted(slot->second))throw std::runtime_error("Scratch root release refused a changed identity or root flag; lease retained.");
        backend.require_idle(slot->second);
        backend.clear_root(slot->second);
        if(backend.rooted(slot->second))throw std::runtime_error("Scratch root release failed readback; lease retained.");
        records.erase(slot);return true;
    }
};
}
