#include "root_lease.hpp"
#include <iostream>
#include <memory>
#include <vector>
#include <functional>
struct Object { bool valid=true,fresh=true,root=false,running=false;int queue=0;std::uintptr_t outer=100; };
struct State {std::vector<Object> objects;int set=0,clear=0;bool root_before=false,nonfresh=false,fail_set=false,fail_readback=false,throw_after_set=false,clear_failure=false,invalid_after_set=false;};
struct Fake {
    using Record=std::size_t;
    std::shared_ptr<State> state;
    Record create(std::uintptr_t outer) {Object o;o.outer=outer;o.root=state->root_before;o.fresh=!state->nonfresh;state->objects.push_back(o);return state->objects.size()-1;}
    bool fresh(Record r){return state->objects[r].fresh;}
    bool valid(Record r){return state->objects[r].valid && state->objects[r].outer==100;}
    bool rooted(Record r){return state->objects[r].root;}
    void require_idle(Record r){if(state->objects[r].running || state->objects[r].queue)throw std::runtime_error("active");}
    void set_root(Record r){++state->set;if(state->fail_set)throw std::runtime_error("set failure");state->objects[r].root=!state->fail_readback;if(state->invalid_after_set)state->objects[r].valid=false;if(state->throw_after_set)throw std::runtime_error("failure after owned set");}
    void clear_root(Record r){++state->clear;if(!state->clear_failure)state->objects[r].root=false;}
    std::uintptr_t address(Record r){return 1000+r;}
};
int main() {
    int passed=0;auto check=[&](bool value){if(!value)throw std::runtime_error("Lease assertion failed.");++passed;};
    auto fails=[&](const std::function<void()>& fn){bool caught=false;try{fn();}catch(const std::runtime_error&){caught=true;}check(caught);};
    {
        auto s=std::make_shared<State>();fanservice::ScratchRoots<Fake> roots(Fake{s});auto [token,address]=roots.create(100);
        check(token==1 && address==1000 && s->objects[0].root);check(s->set==1 && s->clear==0);
        check(roots.inspect(token,[](auto record){return record;})==0);
        fails([&]{roots.inspect(999,[](auto record){return record;});});
        for(auto& o:s->objects)if(!o.root)o.valid=false;
        check(s->objects[0].valid);check(roots.release(token));check(!s->objects[0].root && s->clear==1);check(!roots.release(token));
        fails([&]{roots.inspect(token,[](auto record){return record;});});
        auto next=roots.create(100);check(next.first>token && next.second!=address);check(roots.release(next.first));
    }
    for(int scenario=0;scenario<4;++scenario) {
        auto s=std::make_shared<State>();s->root_before=scenario==0;s->nonfresh=scenario==1;s->fail_set=scenario==2;s->fail_readback=scenario==3;
        fanservice::ScratchRoots<Fake> roots(Fake{s});fails([&]{roots.create(100);});check(s->clear==0);
        check(s->objects[0].root==s->root_before);
    }
    for(int scenario=0;scenario<4;++scenario) {
        auto s=std::make_shared<State>();fanservice::ScratchRoots<Fake> roots(Fake{s});auto lease=roots.create(100);
        if(scenario==0)s->objects[0].outer=999;if(scenario==1)s->objects[0].valid=false;
        if(scenario==2)s->objects[0].running=true;if(scenario==3)s->objects[0].queue=1;
        fails([&]{roots.release(lease.first);});check(s->clear==0 && s->objects[0].root);
    }
    {
        auto s=std::make_shared<State>();fanservice::ScratchRoots<Fake> roots(Fake{s});auto lease=roots.create(100);s->objects[0].root=false;
        fails([&]{roots.release(lease.first);});check(s->clear==0);check(!roots.release(999));
    }
    {
        auto s=std::make_shared<State>();s->throw_after_set=true;fanservice::ScratchRoots<Fake> roots(Fake{s});
        fails([&]{roots.create(100);});check(s->clear==1 && !s->objects[0].root);check(!roots.release(1));
    }
    {
        auto s=std::make_shared<State>();s->invalid_after_set=true;fanservice::ScratchRoots<Fake> roots(Fake{s});
        fails([&]{roots.create(100);});check(s->clear==0 && s->objects[0].root);
        s->objects[0].valid=true;check(roots.release(1));check(!s->objects[0].root);
    }
    {
        auto s=std::make_shared<State>();fanservice::ScratchRoots<Fake> roots(Fake{s});auto lease=roots.create(100);s->clear_failure=true;
        fails([&]{roots.release(lease.first);});check(s->objects[0].root);s->clear_failure=false;check(roots.release(lease.first));
    }
    std::cout<<passed<<" scratch-root lease contracts passed.\n";
}
