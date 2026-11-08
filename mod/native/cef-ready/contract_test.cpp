#include "readiness.hpp"
#include <cassert>
#include <map>
#include <iostream>
using namespace fanservice::cef;
struct Fixture {
    std::map<std::uintptr_t,std::uint64_t> data;
    Fixture(){data={{singleton_rva,0x1000},{configuration_rva,0x2000},{0x2070,0},{0x1020,0x3000},{0x3000,runnable_vtable_rva},{0x3008,0x1000},{0x3010,0}};}
    template<class T>T operator()(std::uintptr_t address,T)const{return static_cast<T>(data.at(address));}
    State inspect()const{return fanservice::cef::inspect(0,*this);}
};
int main(){
    Fixture f;assert(f.inspect()==State::starting);
    f.data[0x3010]=1;assert(f.inspect()==State::starting);
    f.data[0x3010]=2;assert(f.inspect()==State::running);
    f.data[0x3010]=3;assert(f.inspect()==State::stopped);
    f.data[0x2070]=1;assert(f.inspect()==State::disabled);
    f.data[0x2070]=0;f.data[0x1020]=0;assert(f.inspect()==State::starting);
    f.data[singleton_rva]=0;assert(f.inspect()==State::unavailable);
    for(auto address:{0x3000,0x3008,0x3010}){Fixture changed;changed.data[address]=99;bool rejected=false;try{changed.inspect();}catch(const std::runtime_error&){rejected=true;}assert(rejected);}
    Fixture changed;int reads=0;auto reader=[&](std::uintptr_t address,auto value){auto result=changed(address,value);if(++reads==7)changed.data[singleton_rva]=0x9000;return result;};
    assert(inspect(0,reader)==State::unavailable);
    std::cout<<"CEF readiness contract passed\n";
}
